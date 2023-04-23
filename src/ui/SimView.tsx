import React, {useEffect, useState, useRef} from "react"
import {Tab, Nav, NavDropdown} from 'react-bootstrap';
import classNames from 'classnames';
import CodeMirror from '@uiw/react-codemirror';
import { bbedit } from '@uiw/codemirror-theme-bbedit';
import { lineNumbers } from "@codemirror/view"

import { riscv as riscvLang } from './riscvLang';
import { Radix, parseInt, intToStr } from "utils/radix"
import { Simulator } from "simulator/simulator";
import { registerNames } from "simulator/constants";
import { Example } from "./examples";
import { StyleProps, getStyleProps } from "./reactUtils";

import "./SimView.css"

type Props = {
    sim: {sim: Simulator},
    code: string,
    assembled: [number, bigint][],
    examples: Example[],
    onCodeChange?: (code: string) => void,
    onRegisterChange?: (i: number, val: bigint) => void,
    onDataChange?: (data: bigint[]) => void,
    onLoadExample?: (example: Example) => void,
} & StyleProps

/** Converts a line number into a hex address. */
function hexLine(num: number, inc: number, start: bigint = 0n): string {
    return intToStr(start + BigInt((num - 1) * inc), "hex")
}

export default function SimView(props: Props) {
    const {sim} = props.sim;
    const [memRadix, setMemRadix] = useState<Radix>("hex")
    const [memWordSize, setDataMemWordSize] = useState<number>(32)
    const [regRadix, setRegRadix] = useState<Radix>("hex")

    const lines = props.code.split("\n")
    const listing = props.assembled.map(([line, instr], i) => (
        {addr: Simulator.textStart + BigInt(i * 4), instr, line: lines[line - 1].trim()}
    ))

    const [tab, setTab] = useState("code")

    const instrMemTable = useRef<HTMLTableElement>(null)
    useEffect(() => {
        instrMemTable.current?.querySelector(".current-instruction")?.scrollIntoView({behavior: "smooth", block: "nearest"})
    }, [sim.pc.data])


    return (
        <Tab.Container activeKey={tab} onSelect={(k) => setTab(k ?? "code")}>
            <div {...getStyleProps(props, {className: "sim-view d-flex flex-column"})}>
                <Nav variant="tabs" className="flex-row flex-nowrap">
                    <Nav.Item><Nav.Link eventKey="code">Code</Nav.Link></Nav.Item>
                    <Nav.Item><Nav.Link eventKey="registers">Registers</Nav.Link></Nav.Item>
                    <Nav.Item><Nav.Link eventKey="memory">Memory</Nav.Link></Nav.Item>
                </Nav>
                <Tab.Content className="flex-grow-overflow">
                    <Tab.Pane eventKey="code" title="Code">
                        <div className="h-100"  style={{overflow: "auto"}}>
                            <table ref={instrMemTable} className="table table-striped table-hover table-bordered address-table">
                                <thead>
                                    <tr><th>Address</th><th>Instruction</th><th>Code</th></tr>
                                </thead>
                                <tbody>
                                    {listing.map(({addr, instr, line}) => (
                                        <tr key={`${addr}`} className={classNames({"current-instruction": addr === sim.pc.data})}>
                                            <td>{intToStr(addr, "hex")}</td><td>{intToStr(instr, "hex")}</td><td>{line}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Tab.Pane>
                    <Tab.Pane eventKey="registers" title="Registers">
                        <div className="d-flex flex-column h-100">
                            <select id="regFile-radix" className="form-select m-1" value={regRadix}
                                    onChange={(e) => setRegRadix(e.target.value as Radix)}
                            >
                                <option value="hex">Hex</option>
                                <option value="signed">Signed Decimal</option>
                                <option value="unsigned">Unsigned Decimal</option>
                            </select>
                            <div className="flex-grow-overflow"  style={{overflow: "auto"}}>
                                <table
                                    className="table table-striped table-hover table-bordered address-table"
                                    spellCheck={false}
                                >
                                    <tbody>
                                        {sim.regFile.registers.map((reg, i) => (
                                            <tr key={i}>
                                                <td>{`${registerNames[i]} (x${i})`}</td><td>{intToStr(reg, regRadix)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </Tab.Pane>
                    <Tab.Pane eventKey="memory" title="Memory" className="">
                        <div className="d-flex flex-column h-100">
                            <div className="d-flex flex-row">
                                <select id="dataMem-radix" className="form-select m-1" value={memRadix}
                                    onChange={(e) => setMemRadix(e.target.value as Radix)}
                                >
                                    <option value="hex">Hex</option>
                                    <option value="signed">Signed Decimal</option>
                                    <option value="unsigned">Unsigned Decimal</option>
                                </select>
                                <select id="dataMem-word-size" className="form-select m-1" value={memWordSize}
                                    onChange={(e) => setDataMemWordSize(+e.target.value)}
                                >
                                    <option value="8">Byte</option>
                                    <option value="16">Half-Word</option>
                                    <option value="32">Word</option>
                                </select>
                            </div>
                            <div className="flex-grow-overflow"  style={{overflow: "auto"}}>
                                <table
                                    className="table table-striped table-hover table-bordered address-table"
                                    spellCheck={false}
                                >
                                    <tbody>
                                        {[...sim.dataMem.data.dump(memWordSize / 8)].map(([addr, val]) =>
                                            (typeof addr == "bigint") ? (
                                                <tr key={`${addr}`}><td>{intToStr(addr, "hex")}</td> <td>{intToStr(val, memRadix, memWordSize)}</td></tr>
                                            ) : (
                                                <tr key={`${addr}`}><td colSpan={2}>...</td></tr>
                                            )
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </Tab.Pane>
                </Tab.Content>
            </div>
        </Tab.Container>
   )
}