import { Simulator } from "simulator/simulator";
import { registerNames } from "simulator/constants"
import { assembleKeepLineInfo } from "assembler/assembler"
import { Radix, parseInt, intToStr } from "utils/radix"

import { Example, examples } from "./examples";
// import { DataPathElem, datapathElements } from "./datapath";

import $ from "jquery"
import CodeMirror from "codemirror";
import "codemirror/addon/display/placeholder"
import "codemirror/lib/codemirror.css"
import "./risc-mode"
import tippy, { followCursor, Instance as Tippy } from 'tippy.js';
import "tippy.js/dist/tippy.css";
import toastr from "toastr";
import { Bits } from "utils/bits";

type CodeMirror = CodeMirror.Editor

/** Converts a line number into a hex address. */
export function hexLine(num: number, inc: number, start: bigint = 0n): string {
   let numB = start + BigInt((num - 1) * inc)
   return intToStr(numB, "hex")
}

/** State the simulation is in. */
type State = "unstarted" | "running" | "done"

/**
 * Handles the GUI
 */
export class VisualSim {
   private sim: Simulator
   // private datapathElements: Record<string, DataPathElem> = {}
   private examples: Example[] = []

   private svg: HTMLElement
   private editors: HTMLElement
   private instrMemPanel: HTMLElement
   private dataMemPanel: HTMLElement
   private regFilePanel: HTMLElement
   private instrMemEditor: CodeMirror
   private dataMemEditor: CodeMirror

   private state: State = "unstarted"
   private playing: number = 0; // Timer handle to the play loop, or 0 if not playing.

   constructor() {
      this.sim = new Simulator()
      this.examples = examples
      // this.datapathElements = datapathElements

      // initialize elements
      this.svg = $("#datapath svg")[0]
      this.editors = $("#editors")[0]
      this.instrMemPanel = $("#instrMem-panel")[0]
      this.dataMemPanel = $("#dataMem-panel")[0]
      this.regFilePanel = $("#regFile-panel")[0]

      // Set up the Instruction Memory Tab
      this.instrMemEditor = CodeMirror.fromTextArea($(this.instrMemPanel).find<HTMLTextAreaElement>(".editor textarea")[0], {
         mode: "riscv",
         lineNumbers: true,
      });

      // Set up the Data Memory Tab
      this.dataMemEditor = CodeMirror.fromTextArea($(this.dataMemPanel).find<HTMLTextAreaElement>(".editor textarea")[0], {
         lineNumbers: true, // we'll set lineNumberFormatter in updateSimulation
      });

      // set up the Register File tab
      for (let [i, name] of registerNames.entries()) {
         $(this.regFilePanel).find(".editor tbody").append(`
                <tr> <td>${name} (x${i})</td> <td><input type="text"></td> </tr>
            `)
      }
      $(this.regFilePanel).find(".editor input").eq(0).prop("disabled", true) // disable x0

      // Setup examples dropdown
      this.examples.forEach((example) => $("#examples .dropdown-menu").append(
         $(`<li>
                <a class="dropdown-item" href="#" data-example-name="${example.name}"
                   data-bs-toggle="tooltip" title="${example.description}">${example.name}</a>
               </li>`)
      ))

      this.setupEvents()
      this.setupDatapath()

      this.update()
   }

   /** Display an error message to the user. Newlines will be converted to <br/> */
   private error(message: string) {
      toastr.error(message.replace(/\n/g, "<br/>"))
   }

   private dataMemRadix(): Radix { return $("#dataMem-radix").val() as Radix; }
   /** Word size set for memory, as bits. */
   private dataMemWordSize(): number { return +($("#dataMem-word-size").val() as string); }
   private regFileRadix(): Radix { return $("#regFile-radix").val() as Radix; }

   /** Speed as ms between steps when playing */
   private speed(): number {
      let power = +($("#speed").val() as string) // (2 ** slider) steps per second 
      return (1 / (2 ** power)) * 1000 // convert to ms per step
   }

   private setupEvents() {
      $("#editor-tabs").on("shown.bs.tab", (event) => {
         let tab = $($(event.target).data("bs-target")).find(".CodeMirror")[0] as any
         if (tab) tab.CodeMirror.refresh() // We have to refresh the CodeMirror after it is shown
      })

      // reformat number on input
      $(this.regFilePanel).on("change", "input", (event) => this.updateEditorsAndViews())

      $("#dataMem-radix, #dataMem-word-size, #regFile-radix").on("change", (event) => this.updateEditorsAndViews())

      $("#examples").on("click", ".dropdown-item", (event) => {
         this.loadExample(event.target.dataset.exampleName)
         event.preventDefault()
      })

      $("#play").on("click", (event) => this.play())
      $("#pause").on("click", (event) => this.pause())
      $("#speed").on("change", (event) => this.updatePlaySpeed())
      $("#step").on("click", (event) => this.step())
      $("#restart").on("click", (event) => this.restart())
   }

   /**
    * Create some CSS rules for hover and powered wires so that we can have the hover width and wire markers relative 
    * to what is defined in the SVG.
    * 
    * If we did this in static CSS we'd have to hardcode the hover width. And we can't fix the powered marker colors in
    * static CSS unless we make inkscape (or SVGO) output marker-start/mid/end as attributes instead of styles somehow
    * so we could use `[marker-end] { marker-end: url(#Arrow-powered) }`. In SVG2, there's a context-fill value that
    * can be used to inherit colors from the line easily, but its not supported yet.
    * 
    * The purpose of this is to make the SVG more flexible, and allow us to have multiple database SVGs in the future.
    * 
    * An alternative, more traditional method would be to make JS events on power/hover that set the inline styles. But
    * then I'd have to worry about reverting state back to default. I might consider changing to that, but I think
    * making the CSS is simpler and faster. Its also easier to switch to static CSS if SVG2 or the `attr()` CSS
    * function ever get supported.
    */
   private generateDynamicSvgCss() {
      let wires = $(this.svg).find(".wire").not("marker .wire").get()

      let strokeWidths = new Set(wires.map(wire => {
         let width = $(wire).css("stroke-width")
         $(wire).attr("data-stroke-width", width)
         return width
      }))
      let hoverRules = [...strokeWidths].map(width => `
            .wires:hover .wire[data-stroke-width="${width}"], .wire[data-stroke-width="${width}"]:hover {
                stroke-width: calc(${width} * 1.5) !important
            }
        `)

      let markerPos = ["start", "mid", "end"]
      let markers = new Set(wires.flatMap(wire => markerPos.map(pos => {
         // marker must be of form "url(#marker-id)" or "url(https://current-address.com/#marker-id)"
         let marker = $(wire).css(`marker-${pos}`).trim().match(/url\(\s*"?.*?#(.+?)"?\s*\)/)?.[1]
         if (marker && marker != "none") {
            $(wire).attr(`data-marker-${pos}`, marker)
            return marker
         }
         return ""
      }).filter(marker => marker)))
      let markerRules = [...markers].flatMap(marker => markerPos.map(pos => `
            .powered.wire[data-marker-${pos}="${marker}"] {
                marker-${pos}: url("#${marker}-powered") !important
            }
        `))

      // Create "powered" versions of markers used on paths so that we can make the markers change color with the wire
      markers.forEach(markerId => $(`#${markerId}`).clone()
         .attr("id", `${markerId}-powered`)
         .addClass("powered")
         .insertAfter(`#${markerId}`)
      )

      let rules = [...hoverRules, ...markerRules]

      // inject the generated styles into the SVG
      let style = $("<style>").addClass("dynamic-styles").prependTo(this.svg)[0] as HTMLStyleElement
      // rules.forEach(rule => style.sheet!.insertRule(rule)) // this works, but doesn't show the CSS in the inspector
      $(style).text(rules.join("\n"))
   }

   private setupDatapath() {
      // for (let [id, config] of Object.entries(this.datapathElements)) {
      //    let elem = $(this.svg).find(`#${id}`)

      //    // Verify the SVG contains the things we expect
      //    if (!elem.length) throw Error(`${id} doesn't exist`);
      //    if (config.powered && !elem.hasClass("wire") && !elem.find(".wire").length)
      //       throw Error(`#${id} has powered defined, but no ".wire" elements`);

      //    if (config.description || config.tooltip) {
      //       tippy(elem[0], {
      //          followCursor: true, // or "initial" keep it where you entered
      //          allowHTML: true,
      //          maxWidth: "20em",
      //          plugins: [followCursor],
      //       });
      //    }

      //    if (config.onclick) {
      //       let onclick = config.onclick // rescope to capture current value and let typescript know is defined.
      //       elem.on("click", (event) => onclick(this))
      //    }

      //    if (config.label && !elem.find("text.value-label").length)
      //       throw Error(`#${id} has label defined, but no ".value-label" elements`);

      //    if (config.showSubElemsByValue && !elem.find("[data-show-on-value]").length)
      //       throw Error(`#${id} has showSubElemsByValue defined, but no "[data-show-on-value]" elements`);
      // }

      this.generateDynamicSvgCss()
   }

   /**
    * Load code/memory/registers and start the simulation, updates state
    * Returns true if started successfully, false otherwise.
    */
   private start() {
      // Get memory, instructions, registers
      let code = this.instrMemEditor.getValue()
      try {
         var assembled = assembleKeepLineInfo(code)
      } catch (e: any) {
         this.error(`Couldn't parse code:\n${e.message}`)
         return false
      }

      if (assembled.length === 0) {
         this.error("Please enter some code to run.")
         return false
      }

      let lines = code.split("\n")
      let asmCode = assembled.map(([line, instr]) => lines[line - 1].trim())
      let machineCode = assembled.map(([line, instr]) => instr)

      let memRadix = this.dataMemRadix()
      let memWordSize = this.dataMemWordSize()
      let memStr = this.dataMemEditor.getValue().trim()
      try {
         // split("") equals [""] for some reason
         var mem = memStr.split("\n").filter(s => s).map(s => parseInt(s, memRadix, memWordSize));
      } catch (e: any) {
         this.error(`Couldn't parse data memory:\n${e.message}`)
         return false
      }

      let regRadix = this.regFileRadix()
      let regStrs = $(this.regFilePanel).find(".editor input").get().map(elem => $(elem).val() as string)
      try {
         var regs: Record<number, bigint> = {}
         for (let [i, s] of regStrs.entries()) {
            if (s) regs[i] = parseInt(s, regRadix, 32)
         }
      } catch (e: any) {
         this.error(`Couldn't parse registers:\n${e.message}`)
         return false
      }

      // We've got all the data so we can start the simulator
      this.sim.setCode(machineCode)
      this.sim.setRegisters(regs)
      this.sim.ram.data.storeArray(0n, memWordSize / 8, mem);

      // setup Instruction Memory view
      let instrMemTable = $(this.instrMemPanel).find(".view tbody")
      instrMemTable.empty()
      for (let [i, instr] of machineCode.entries()) {
         let line = asmCode[i];
         let addr = Simulator.textStart + BigInt(i * 4)
         instrMemTable.append(`
                <tr> <td>${intToStr(addr, "hex")}</td> <td>${intToStr(instr, "hex")}</td> <td>${line}</td> </tr>
            `)
      }

      // Data Memory view is recreated every tick.

      // set up Register File view if needed
      let regFileTable = $(this.regFilePanel).find(".view tbody")
      if (regFileTable.children().length == 0) {
         for (let [i, name] of registerNames.entries()) {
            regFileTable.append(`
                    <tr> <td>${name} (x${i})</td> <td class="register-value"></td> </tr>
                `)
         }
      }

      // Switch to views
      $(this.editors).find(".editor").hide()
      $(this.editors).find(".view").show()

      this.state = "running"
      return true
   }

   /** Updates the controls to match simulator state. */
   private updateControls() {
      $("#play").prop("disabled", this.state == "done")
      $("#play").toggle(!this.playing)

      $("#pause").toggle(!!this.playing) // convert to bool

      $("#step").toggle(!this.playing)
      $("#step").prop("disabled", this.playing || this.state == "done")

      $("#restart").toggle(this.state != "unstarted")

      $("#speed").toggle(!!this.playing)
   }

   /** Update the editor and view panels to match the simulation */
   private updateEditorsAndViews() {
      let memRadix = this.dataMemRadix()
      let memWordSize = this.dataMemWordSize()
      let regRadix = this.regFileRadix()

      if (this.state == "unstarted") {
         // renumber instruction input to match radix
         this.dataMemEditor.setOption("lineNumberFormatter", (l) => hexLine(l, memWordSize / 8))

         // update Register File input placeholders and values to match radix
         let registerTds = $(this.regFilePanel).find(".editor input").get()
         for (let [i, reg] of this.sim.registerFile.registers.entries()) {
            $(registerTds[i]).prop("placeholder", intToStr(reg, regRadix))
            let valStr = $(registerTds[i]).val() as string
            if (valStr) { // update the current values to match the radix. Clear if invalid.
               try {
                  valStr = intToStr(parseInt(valStr, regRadix, 32), regRadix)
               } catch {
                  valStr = ""
               }
               $(registerTds[i]).val(valStr)
            }
         }
      } else { // this.state == "running" or this.state == "done"
         // Update Instruction Memory
         $(this.instrMemPanel).find(".current-instruction").removeClass("current-instruction")
         if (this.state != "done") { // don't show current instruction if we are done.
            let line = Number((this.sim.instructionMemory.addr - Simulator.textStart) / 4n)
            let currentInstr = $(this.instrMemPanel).find(".view tbody tr")[line]
            currentInstr.classList.add("current-instruction")
            currentInstr.scrollIntoView({ behavior: "smooth", block: "nearest" })
         }

         // Update Data Memory
         $(this.dataMemPanel).find(".view tbody").empty()
         for (let [addr, val] of this.sim.ram.data.dump(memWordSize / 8)) {
            let elem: string
            if (typeof addr == "bigint") {
               elem = `<tr> <td>${intToStr(addr, "hex")}</td> <td>${intToStr(val, memRadix, memWordSize)}</td> </tr>`
            } else {
               elem = `<tr><td colspan="2">...</td></tr>`
            }
            $(this.dataMemPanel).find(".view tbody").append(elem)
         }

         // update Register File
         let registerTds = $(this.regFilePanel).find(".view .register-value").get()
         for (let [i, reg] of this.sim.registerFile.registers.entries()) {
            $(registerTds[i]).text(`${intToStr(reg, regRadix)}`)
         }
      }
   }

   /** Updates datapath to match simulator state. */
   private updateDatapath() {
      // let running = (this.state == "running")

      // $(this.svg).find(".hide-when-running").toggle(!running)
      // $(this.svg).find(".hide-when-not-running").toggle(running)

      // for (let [id, config] of Object.entries(this.datapathElements)) {
      //    let elem = $(this.svg).find(`#${id}`)

      //    if (config.description || config.tooltip) {
      //       let tooltip = (elem[0] as any)._tippy as Tippy
      //       let value = running && config.tooltip ? config.tooltip(this.sim) : undefined
      //       let description = (!running || !config.hideDescriptionWhenRunning) ? config.description : undefined
      //       let content = [description, value].filter(s => s).join("<hr/>")
      //       tooltip.setContent(content)

      //       if (content) {
      //          tooltip.enable()
      //       } else {
      //          tooltip.hide(); // disable will lock the tooltip open if it was open
      //          tooltip.disable()
      //       }
      //    }

      //    if (running && config.powered && config.powered(this.sim)) {
      //       // add powered to elem if its a wire, and any wires under elem
      //       elem.filter(".wire").add(elem.find(".wire")).addClass("powered")
      //    } else {
      //       elem.filter(".wire").add(elem.find(".wire")).removeClass("powered")
      //    }

      //    if (config.label) {
      //       let content = running ? config.label(this.sim) : "" // set labels empty if not running
      //       elem.find(".value-label").each((i, text) => {
      //          // use first tspan if there is one, else place direclty in text element.
      //          let labelElem = $(text).find("tspan")[0] ?? text
      //          $(labelElem).text(content)
      //       })
      //    }

      //    if (config.showSubElemsByValue) {
      //       elem.find("[data-show-on-value]").hide()
      //       if (running) {
      //          let val = config.showSubElemsByValue(this.sim)
      //          elem.find(`[data-show-on-value="${val}"]`).show()
      //       }
      //    }

      //    if (config.callback) {
      //       config.callback(this)
      //    }
      // }
   }

   /** update controls, editors, views, and datapath */
   private update() {
      this.updateControls()
      this.updateEditorsAndViews()
      this.updateDatapath()
   }

   /** Start playing the simulation. */
   public play() {
      if (this.step()) { // try to do first step immediately
         this.updatePlaySpeed(); // calls setInterval() and sets this.playing
      }
   }

   /** Starts or updates a setInterval() with the speed from the speed slider. */
   public updatePlaySpeed() {
      if (this.playing) this.pause()
      this.playing = window.setInterval(() => {
         if (!this.step()) this.pause() // keep stepping until the simulation is finished
      }, this.speed())
      this.updateControls()
   }

   /** Stop playing the simulation */
   public pause() {
      clearInterval(this.playing)
      this.playing = 0;
      this.updateControls()
   }

   /** Steps simulation. Returns true if we can continue stepping, or false if the simulation failed to start or is done. */
   public step() {
      if (this.state == "unstarted")
         this.start() // try to start, updates state to running if success

      if (this.state == "running") { // don't do anything if we are "done" or if start failed
         try {
            let canContinue = this.sim.tick()
            if (!canContinue) this.state = "done"
         } catch (e: any) { // this shouldn't happen.
            this.state = "done"
            this.error(`Error in simulation:\n${e.message}`)
            console.error(e)
         }
      }
      this.update()
      return this.state == "running"
   }

   /** Restarts the simulation, set everything back to editor views so we can change the code/memory/registers. */
   public restart() {
      this.sim = new Simulator() // reset the simulator
      this.state = "unstarted"
      if (this.playing) this.pause(); // clear interval

      // Switch back to editors
      $(this.editors).find(".view").hide()
      $(this.editors).find(".editor").show()
      this.instrMemEditor.refresh()
      this.dataMemEditor.refresh()

      this.update()
   }

   /** Clears all code, registers, and data back to default */
   public reset(example?: Example) {
      this.restart()

      this.instrMemEditor.setValue(example?.code ?? "")
      this.dataMemEditor.setValue(example?.memory ?? "")

      $("#dataMem-radix").val(example?.dataMemRadix ?? "hex")
      $("#dataMem-word-size").val(example?.dataMemWordSize ?? 32)
      $("#regFile-radix").val(example?.regFileRadix ?? "hex")

      let registerInputs = $(this.regFilePanel).find(".editor input")
      registerInputs.each((i, input) => {
         $(input).val(example?.registers?.[i] ?? "")
      })

      this.update()
   }

   /** Loads an example by name */
   public async loadExample(name: string) {
      let example = this.examples.find(e => e.name === name)!
      if (!example.code && example.url) {
         example.code = await (await fetch(example.url)).text()
      }

      this.reset(example)
   }
}
