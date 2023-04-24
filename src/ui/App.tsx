import React, {useState, useRef} from "react"
import toastr from "toastr";
import "toastr/build/toastr.css"

import { examples, Example } from "./examples";
import { Radix, parseInt } from "utils/radix";
import { Simulator } from "simulator/simulator";
import { assembleKeepLineInfo } from "assembler/assembler"
import SimEditor from "./SimEditor";
import SimView from "./SimView";
import SimControls from "./SimControls";
import SimDatapath from "./SimDatapath";
import datapath from "assets/datapath.svg" // import path to the svg
import { DataPathElem, datapathElements } from "./datapath";

import 'bootstrap/dist/css/bootstrap.min.css';
import "@fortawesome/fontawesome-free/css/all.css"
import "css/site.css"
import "tippy.js/dist/tippy.css";

type Props = {
}

toastr.options = {
    positionClass: "toast-top-left",
    closeButton: true,
    timeOut: 8000,
    // timeOut: 0,
    // extendedTimeOut: 0,
    preventDuplicates: true,
}

export default function App(props: Props) {
    // NOTE: Simulator is mutable, so use a ref, and manually update a counter to trigger rerender.
    // It is not recommended to read a Ref during render, so maybe consider doing deepClone? Though that seems to be a bit expensive.
    const sim = useRef<Simulator>()
    if (!sim.current) sim.current = new Simulator()
    const [simUpdateCounter_, setSimUpdateCounter_] = useState(0)
    // Updates the sim and updates the counter so react rerenders
    const updateSim = <T,>(func: (sim: Simulator) => T): T => {
        const rtrn = func(sim.current!)
        setSimUpdateCounter_(c => c + 1)
        return rtrn;
    }

    const [state, setState] = useState<"unstarted"|"playing"|"paused"|"done">("unstarted")
    const [speed, setSpeed] = useState(1)

    const [code, setCode] = useState("")
    const [assembled, setAssembled] = useState<[number, bigint][]>([])
    const [registers, setRegisters_] = useState<bigint[]>(() => Array(32).fill(0n))
    const setRegisters = (regs: Record<number, bigint>) => {
        setRegisters_(registers.map((val, i) => regs[i] ?? val))
    }
    const [data, setData] = useState<string>("")
    const [dataRadix, setDataRadix] = useState<Radix>("hex")
    const [dataWordSize, setDataWordSize] = useState(32)

    const reset = (example?: Example) => {
        setState("unstarted")
        setCode(example?.code ?? "")
        setAssembled([])
        setRegisters(Array(32).fill(0n).map((_, i) => example?.registers?.[i] ?? 0n))
        setData(example?.memory ?? "")
        setDataRadix(example?.dataMemRadix ?? "hex")
        setDataWordSize(example?.dataMemWordSize ?? 32)
    }

    /**
     * Load code/memory/registers and start the simulation.
     * Returns true if started successfully, false otherwise.
     */
    const start = () => {
        try {
            var newAssembled = assembleKeepLineInfo(code)
            setAssembled(newAssembled)
        } catch (e: any) {
            console.error(`Couldn't parse code:\n${e.message}`) // TODO
            return false
        }

        if (newAssembled.length === 0) {
            console.error("Please enter some code to run.")
            return false
        }

        try {
            var mem = data.split("\n").filter(s => s).map(s => parseInt(s, dataRadix, dataWordSize));
        } catch (e: any) {
            console.error(`Couldn't parse data memory:\n${e.message}`)
            return false
        }

        // We've got all the data so we can start the simulator
        sim.current = new Simulator()
        updateSim(sim => {
            sim.setCode(newAssembled.map(([line, instr]) => instr))
            sim.setRegisters(registers)
            sim.dataMem.data.storeArray(0n, dataWordSize / 8, mem)
        })

        return true
    }

    /** Steps simulation. */
    const step = (mode: "play"|"step") => {
        let nextState = state
        if (nextState == "unstarted") { // try to start if we are unstarted
            const started = start() // try to start, updates state to paused if success
            if (started) nextState = (mode == "play" ? 'playing' : 'paused')
        }

        if (["paused", "playing"].includes(nextState)) { // don't do anything if we are "done" or if start failed
            try {
                updateSim(sim => sim.tick())
                if (sim.current!.isDone()) nextState = "done"
            } catch (e: any) { // this shouldn't happen.
                nextState = "done"
                console.error(`Error in simulation:\n${e.message}`) // TODO
            }
        }

        setState(nextState)
    }

    const loadExample = async (example: Example) => {
        if (!example.code && example.url) {
            example.code = await fetch(example.url).then(res => res.text())
        }
        reset(example)
    }

    return (
        <div id="app">
            <div className="container-fluid d-flex flex-row p-2" style={{height: "100vh"}}>
                <SimDatapath className="flex-grow-1" sim={sim.current!} datapathUrl={datapath} datapathElements={datapathElements} state={state}/>
                <div className="d-flex flex-column" style={{height: "100%", maxWidth: "50%"}}>
                    {state == "unstarted" ? (
                        <SimEditor className="flex-grow-overflow"
                            code={code} onCodeChange={setCode}
                            data={data} onDataChange={setData}
                            dataRadix={dataRadix} onDataRadixChange={setDataRadix}
                            dataWordSize={dataWordSize} onDataWordSizeChange={setDataWordSize}
                            registers={registers} onRegisterChange={(i, val) => setRegisters({[i]: val})}
                            examples={examples} onLoadExample={loadExample}
                        />
                    ) : (
                        <SimView className="flex-grow-overflow"
                            sim={sim.current!} code={code} assembled={assembled}
                        />
                    )}
                    <SimControls
                        state="unstarted"
                        speed={speed}
                        onStep={() => step("step")}
                        onReset={reset}
                        // onPlay={() => step("play")}
                        // onPause={pause}
                        onSpeedChange={setSpeed}
                    />
                </div>
            </div>
        </div>
   )
}
