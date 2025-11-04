import { Simulator } from "simulator/simulator";
import { registerNames, textStart } from "simulator/constants"
import { assembleKeepLineInfo, disassembleInstruction } from "assembler/assembler"
import { Radix, parseInt, intToStr } from "utils/radix"

import { Example, examples } from "./examples";
import { DataPathElem, datapathElements } from "./datapath";

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

const osCode: string = `# the code begins at address 0x0000_0000
# all ecall starts in this code
j ZZOS_main
.word              0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF,      0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF
.word 0xB8, 0xD4, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF,      0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF
.word 0x104, 0x124, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF,      0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF
.word 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF,      0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF

# 10 = print char = B8
# 11 = print string = D4
# 20 = get char = 104
# 21 = get line = 124

ZZOS_main:
    slli t0, a0, 2
	lw t0, 0(t0)
    addi t1, zero, -1
    beq t0, t1, ZZOS_FAULT
	jalr zero, 0(t0)
ZZOS_FAULT:
	halt

# assume a1 is character to print
ZZOS_print_char:
	# Print char
	lui t0, 0x00021
ZZOS_pc_cw:
	lw t1, 20(t0)
	bne t1, zero, ZZOS_pc_cw
	sb a1, 24(t0)
	addi t1, zero, 0x10
	sw t1, 20(t0)
	ret

# a1: addr of null terminated string
ZZOS_print_string:
	MV a2, a1
	addi t0, zero, %lo(ZZOS_print_string_end)
	SW ra, 0xC(t0)
	# Get char, end if it's null
ZZOS_print_string_loop:
	lb a1, 0(a2)
	beq a1, zero, ZZOS_print_string_end
	jal ra, ZZOS_print_char
	# Increment and loop
	addi a2, a2, 1
	j ZZOS_print_string_loop
ZZOS_print_string_end:
	addi t0, zero, %lo(ZZOS_print_string_end)
	LW ra, 0xC(t0)
	ret
.word 0x0

ZZOS_get_char:
	lui t0, 0x00021
ZZOS_gc_wc:
	lw t1, 0(t0)
	andi t1, t1, 1
	beq t1, zero, ZZOS_gc_wc
	lb a0, 4(t0)
	# manage if multiple chars are in the buffer
	lw t1, 0(t0)
	sw zero, 0(t0)
	ret

# a1: addr of the buffer to put the string in
# Blocks until it receives a newline (0xA)
ZZOS_get_line:
	# Wait for status reg to say there's chars available
	lui t0, 0x00021
	addi t0, t0, 4
	lw t1, -4(t0)
	andi t1, t1, 0x10
	beq t1, zero, ZZOS_get_line
	# Read chars (t0 = read addr, t1 = final addr, t2 = char)
	lw t1, -4(t0)
	andi t1, t1, 0xF
	addi t1, t1, 1
	add t1, t1, t0
ZZOS_get_line_loop:
	lb t2, 0(t0)
	sb t2, 0(a1)
	addi t0, t0, 1
	addi a1, a1, 1
	bne t0, t1, ZZOS_get_line_loop
	# Write back to status reg
	lui t0, 0x00021
	sw zero, 0(t0)
	# Check if we found \n
	addi t0, zero, 0xA
	bne t0, t2, ZZOS_get_line
	# Leave
	sb zero, 0(a1)
	ret`

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
	private datapathElements: Record<string, DataPathElem> = {}
	private examples: Example[] = []

	private svg: HTMLElement
	private editors: HTMLElement
	private instrMemPanel: HTMLElement
	private dataMemPanel: HTMLElement
	private regFilePanel: HTMLElement
	private instrMemEditor: CodeMirror
	// private dataMemEditor: CodeMirror

	private state: State = "unstarted"
	private playing: number = 0 // Timer handle to the play loop, or 0 if not playing.
	private dirLabels: [bigint, string][] = []
	private instrAddrs: bigint[] = []

	constructor() {
		this.sim = new Simulator()
		this.examples = examples
		this.datapathElements = datapathElements

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
			indentWithTabs: true,
			tabSize: 4,
		});
		$(this.editors).find(".view").hide()

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
		if (power == 20)
			return 0 // Super speed mode
		return (1 / (2 ** power)) * 1000 // convert to ms per step
	}

	private setupEvents() {
		$("#editor-tabs").on("click", (event) => {
			// We have to refresh the CodeMirror after it is shown
			let tab = $($(event.target).data("bs-target")).find(".CodeMirror")[0] as any
			if (tab) tab.CodeMirror.refresh()

			// Update the reg mem tabs
			if (this.state != "unstarted" && $(event.target).is("#instrMem-tab")) {
				$("#reg-mem-tabs").show()
			} else {
				$("#reg-mem-tabs").hide()
			}

			// Update everything else
			this.update()
		})

		$("#consoleInput").on("keydown", (event) => {
			if (event.key == "Enter") {
				let text = $(event.target).val() as string
				this.consoleInput(text)
				$(event.target).val("")
			}
		});

		// reformat number on input
		$("#dataMem-radix, #dataMem-word-size, #regFile-radix, #showInstructions").on("change", (event) => this.updateEditorsAndViews())

		$("#examples").on("click", ".dropdown-item", (event) => {
			this.loadExample(event.target.dataset.exampleName)
			event.preventDefault()
		})

		$("#play").on("click", (event) => this.play())
		$("#pause").on("click", (event) => this.pause())
		$("#speed").on("change", (event) => this.updatePlaySpeed())
		$("#next").on("click", (event) => this.next_instruction())
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
			.active.wire[data-marker-${pos}="${marker}"] {
				marker-${pos}: url("#${marker}-active") !important
			}
		`))

		// Create "powered" versions of markers used on paths so that we can make the markers change color with the wire
		markers.forEach(markerId => {
			$(`#${markerId}`).clone()
				.attr("id", `${markerId}-powered`)
				.addClass("powered")
				.insertAfter(`#${markerId}`)

			$(`#${markerId}`).clone()
				.attr("id", `${markerId}-active`)
				.addClass("active")
				.insertAfter(`#${markerId}`)
		})

		let rules = [...hoverRules, ...markerRules]

		// inject the generated styles into the SVG
		let style = $("<style>").addClass("dynamic-styles").prependTo(this.svg)[0] as HTMLStyleElement
		// rules.forEach(rule => style.sheet!.insertRule(rule)) // this works, but doesn't show the CSS in the inspector
		$(style).text(rules.join("\n"))
	}

	private setupDatapath() {
		for (let [id, config] of Object.entries(this.datapathElements)) {
			let elem = $(this.svg).find(`#${id}`)

			// Verify the SVG contains the things we expect
			if (!elem.length) throw Error(`${id} doesn't exist`);
			if (config.powered && !elem.hasClass("wire") && !elem.find(".wire").length)
				throw Error(`#${id} has powered defined, but no ".wire" elements`);

			if (config.description || config.tooltip) {
				tippy(elem[0], {
					followCursor: true, // or "initial" keep it where you entered
					allowHTML: true,
					maxWidth: "20em",
					plugins: [followCursor],
				});
			}

			if (config.onclick) {
				let onclick = config.onclick // rescope to capture current value and let typescript know is defined.
				elem.on("click", (event) => onclick(this))
			}

			if (config.label && !elem.find("text.value-label").length)
				throw Error(`#${id} has label defined, but no ".value-label" elements`);

			if (config.showSubElemsByValue && !elem.find("[data-show-on-value]").length)
				throw Error(`#${id} has showSubElemsByValue defined, but no "[data-show-on-value]" elements`);
		}

		this.generateDynamicSvgCss()
	}

	/**
	 * Load code/memory/registers and start the simulation, updates state
	 * Returns true if started successfully, false otherwise.
	 */
	private start(loadOS = true) {
		// Get code
		let code = this.instrMemEditor.getValue()
		try {
			var assembled = assembleKeepLineInfo(code)
		} catch (e: any) {
			this.error(`Couldn't parse code:\n${e.message}`)
			return false
		}

		if (assembled.machineCode.length === 0) {
			this.error("Please enter some code to run.")
			return false
		}

		let lines = code.split("\n")
		let asmCode: [bigint, string, number][] = assembled.instructions.map(([line, addr]) => {
			let instrInd = Number(addr - textStart) / 4
			let instr = assembled.machineCode[instrInd]
            let disassembleInd = assembled.disassemble.map(([lnum,assem]) => lnum).indexOf(line)
            if( disassembleInd != -1 ) {
                return [instr, assembled.disassemble[disassembleInd][1].trim(), instrInd]
            }
			return [instr, lines[line - 1].trim(), instrInd]
		})
		let machineCode = assembled.machineCode;

		// Load code/data
		this.sim.setCode(machineCode)

		// Load OS
		if (loadOS) {
			let os = assembleKeepLineInfo(osCode)
			this.sim.setOS(os.machineCode)
		}

		// setup Instruction Memory view
		let instrMemTable = $(this.instrMemPanel).find("#instrMem-table")
		instrMemTable.empty()
		for (let [i, [instr, line, index]] of asmCode.entries()) {
			let addr = textStart + BigInt(index * 4)
			let label = ""
			for (const l in assembled.labels) {
				if (assembled.labels[l] === addr) {
					label = "<b>" + l + ": </b>"
					break
				}
			}
			instrMemTable.append(`
				<tr> <td>${intToStr(addr, "hex")}</td> <td>${intToStr(instr, "hex")}</td> <td>${label}${line}</td> </tr>
			`)
		}

		// Set up reg file view
		if ($("#instrMem-tab").hasClass("active"))
			$("#reg-mem-tabs").show()
		let regFileTable = $(this.regFilePanel).find("tbody")
		if (regFileTable.children().length == 0) {
			for (let [i, name] of registerNames.entries()) {
				regFileTable.append(`
					<tr> <td>${name} (x${i})</td> <td class="register-value"></td> </tr>
				`)
			}

			regFileTable.append(`
			<tr> <td>PC</td> <td class="register-value"></td> </tr>
		`)
		}

		// Generate dirLabels for mem view
		this.dirLabels = []
		for (const [label, addr] of Object.entries(assembled.labels)) {
			if (assembled.directives.find(([_, dir_addr]) => addr == dir_addr)) {
				this.dirLabels.push([addr, label])
			}
		}

		// Generate instrAddrs for mem view
		this.instrAddrs = assembled.instructions.map(([_, addr]) => addr)

		// Clear console
		$("#consoleText").text("")

		// Show console tab
		$("#console").show()

		// Hide examples tab
		$("#examples").hide()

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

		$("#next").toggle(!this.playing)
		$("#next").prop("disabled", this.playing || this.state == "done")

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
			// Update Instruction Memory and microarch
			$(this.instrMemPanel).find(".current-instruction").removeClass("current-instruction")
			if (this.state != "done") { // don't show current instruction if we are done.
                let line = BigInt(Bits.toInt(this.sim.wires.pcVal)) // - textStart) / 4n)
                let count = this.instrAddrs.indexOf(line)
				let currentInstr = $(this.instrMemPanel).find(".view tbody tr")[count]
				if (currentInstr) {
					currentInstr.classList.add("current-instruction")
				}
			}

			// Update Data Memory
			let showInstr = $('#showInstructions').prop('checked');
			$(this.dataMemPanel).find("tbody").empty()
			for (let [addr, val] of this.sim.ram.dump(memWordSize / 8)) {
				let elem: string
				if (typeof addr == "bigint") {
					// Check if it's an instruction address
					let isInstr = this.instrAddrs.includes(addr & ~3n)
					// Skip instructions if we don't want to show them
					if (isInstr && !showInstr) {
						continue
					}
                    // skip OS completely as well
                    if (!showInstr && addr <= 0x170) {
                        continue
                    }
					// Show data value
					let label = this.dirLabels.find(([a, _]) => a == addr)?.[1];
					if (label) {
						$(this.dataMemPanel).find("tbody").append(`<tr><td colspan="2"><b>${label}:</b></td></tr>`)
					}
					elem = `<tr> <td>${intToStr(addr, "hex")}</td> <td>${intToStr(val, memRadix, memWordSize)}</td> </tr>`
				} else {
					elem = `<tr><td colspan="2">...</td></tr>`
				}
				$(this.dataMemPanel).find("tbody").append(elem)
			}

			// update Register File
			let registerTds = $(this.regFilePanel).find(".register-value").get()
			for (let [i, reg] of this.sim.registerFile.registers.entries()) {
				$(registerTds[i]).text(`${intToStr(reg, regRadix)}`)
			}
			$(registerTds[32]).text(`${intToStr(Bits.toInt(this.sim.wires.pcVal), regRadix)}`);

			// Update console
			let consoleOutput = $("#consoleText")
			let curr = consoleOutput.text()
			consoleOutput.text(curr + this.sim.ram.consoleOutput)
			this.sim.ram.consoleOutput = ""
		}
	}

	/** Updates datapath to match simulator state. */
	private updateDatapath() {
		let running = (this.state == "running")

		$(this.svg).find(".hide-when-running").toggle(!running)
		$(this.svg).find(".hide-when-not-running").toggle(running)

		let stage: number = this.sim.controlFSM.state;
		const stageNames = ["fetch", "decode", "execute", "mem", "writeback"]
		$(this.svg).find(".active:not(marker)").removeClass("active")
		$(this.svg).find(`[stage=${stageNames[stage]}]`).addClass("active")

        // Update Instruction Memory and microarch
		$(this.instrMemPanel).find(".current-instruction").removeClass("current-instruction")
		if (this.state != "done") { // don't show current instruction if we are done.
            let line = BigInt(Bits.toInt(this.sim.wires.pcVal)) // - textStart) / 4n)
            let count = this.instrAddrs.indexOf(line)
			let currentInstr = $(this.instrMemPanel).find(".view tbody tr")[count]
			if (currentInstr) {
				currentInstr.classList.add("current-instruction")
				// currentInstr.scrollIntoView({ behavior: "smooth", block: "nearest" })
				// Set the current instruction in the microarch
            }
			let text = `${intToStr(this.sim.wires.pcVal,"hex",32)}: ${disassembleInstruction(Bits.toInt(this.sim.instructionMemory.instruction))}`
			// Limit text length to 34 characters
			text = text.length > 50 ? text.slice(0, 50 - 3) + "..." : text
			$(this.svg).find("#currentInstr").text(text)
			
		}

		for (let [id, config] of Object.entries(this.datapathElements)) {
			let elem = $(this.svg).find(`#${id}`)

			if (config.description || config.tooltip) {
				let tooltip = (elem[0] as any)._tippy as Tippy
				let value = running && config.tooltip ? config.tooltip(this.sim) : undefined
				let description = (!running || !config.hideDescriptionWhenRunning) ? config.description : undefined
				let content = [description, value].filter(s => s).join("<hr/>")
				tooltip.setContent(content)

				if (content) {
					tooltip.enable()
				} else {
					tooltip.hide(); // disable will lock the tooltip open if it was open
					tooltip.disable()
				}
			}

			if (running && config.powered && config.powered(this.sim)) {
				// add powered to elem if its a wire, and any wires under elem
				elem.filter(".wire").add(elem.find(".wire")).addClass("powered")
			} else {
				elem.filter(".wire").add(elem.find(".wire")).removeClass("powered")
			}

			if (config.label) {
				let content = running ? config.label(this.sim) : "" // set labels empty if not running
				elem.find(".value-label").each((i, text) => {
					// use first tspan if there is one, else place direclty in text element.
					let labelElem = $(text).find("tspan")[0] ?? text
					$(labelElem).text(content)
				})
			}

			if (config.showSubElemsByValue) {
				elem.find("[data-show-on-value]").hide()
				// if (running) {
				let val = config.showSubElemsByValue(this.sim)
				elem.find(`[data-show-on-value="${val}"]`).show()
				// }
			}

			if (config.callback) {
				config.callback(this)
			}
		}
	}

	/** update controls, editors, views, and datapath */
	private update() {
		this.updateControls()
		if ($("#instrMem-tab").hasClass("active"))
			this.updateEditorsAndViews()
		else
			this.updateDatapath()
	}

	/** Handles console input */
	private consoleInput(text: string) {
		this.sim.ram.consoleInputBuffer += text + "\n"
	}
	/** Start playing the simulation. */
	public play() {
		$("#speed").val(0) // reset speed slider to 0 (super slow)
		if (this.step()) { // try to do first step immediately
			this.updatePlaySpeed(); // calls setInterval() and sets this.playing
		}
	}

	/** Starts or updates a setInterval() with the speed from the speed slider. */
	public updatePlaySpeed() {
		if (this.playing)
			this.pause()

		let speed = this.speed();
		this.playing = window.setInterval(() => {
			if (!this.step(speed == 0 ? 100 : 1))
				this.pause() // keep stepping until the simulation is finished
		}, speed)
		this.updateControls()
	}

	/** Stop playing the simulation */
	public pause() {
		clearInterval(this.playing)
		this.playing = 0;
		this.updateControls()
	}

	/** Runs the machine until it hits the next instruction */
	public next_instruction() {
		// Start on first instruction and don't skip it
		if (this.state == "unstarted")
			this.start()
		// Run to finish of next instruction
		while (this.state == "running") {
			try {
				let canContinue = this.sim.tick()
				if (!canContinue) this.state = "done"
			} catch (e: any) { // this shouldn't happen.
				this.state = "done"
				this.error(`Error in simulation:\n${e.message}`)
				console.error(e)
			}

			if (this.sim.controlFSM.state == 0) {
				break
			}
		}
		this.update()
	}

	/** Steps simulation. Returns true if we can continue stepping, or false if the simulation failed to start or is done. */
	public step(count = 1) {
		if (this.state == "unstarted")
			this.start() // try to start, updates state to running if success

		if (this.state == "running") { // don't do anything if we are "done" or if start failed
			for (let i = 0; i < count; i++) {
				try {
					let canContinue = this.sim.tick()
					if (!canContinue) {
						this.state = "done"
						break
					}
				} catch (e: any) { // this shouldn't happen.
					this.state = "done"
					this.error(`Error in simulation:\n${e.message}`)
					console.error(e)
					break
				}
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

		// Hide reg/mem tabs
		$("#reg-mem-tabs").hide()

		// Hide console
		$("#console").hide()

		// Show examples tab
		$("#examples").show()

		// Switch back to editors
		$(this.editors).find(".view").hide()
		$(this.editors).find(".editor").show()
		this.instrMemEditor.refresh()

		this.update()
	}

	/** Clears all code, registers, and data back to default */
	public reset(example?: Example) {
		this.restart()

		this.instrMemEditor.setValue(example?.code ?? "")

		$("#dataMem-radix").val(example?.dataMemRadix ?? "hex")
		$("#dataMem-word-size").val(example?.dataMemWordSize ?? 32)
		$("#regFile-radix").val(example?.regFileRadix ?? "hex")

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
