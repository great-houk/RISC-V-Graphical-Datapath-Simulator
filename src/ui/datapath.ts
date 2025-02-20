import { Simulator } from "simulator/simulator"
import { VisualSim } from "./visualSim"
import { registerNames } from "simulator/constants"

import { Bits, Bit } from "utils/bits"
import { TruthTable } from "utils/truthTable"
import { Radix, intToStr } from "utils/radix"

/**
 * # SVG
 * 
 * The datapath is rendered on an SVG file. Each wire and component of the simulator is mapped to an ID
 * in the SVG. The SVG also uses classes and data attributes on elements so that we can render the current
 * state of the simulation.
 * 
 * ## Classes
 * - wire 
 *   Can go on a path. Used for emphasizing the hovered wire and coloring powered wires.
 * - wires 
 *   Can go on a group containing wire paths. When a wire-group is hovered all wire paths in it will be emphasized. 
 *   Lets you make labels emphasize their associated wire, or to treat multiple paths as one wire.
 * - value-label 
 *   Indicates a text box which we will show the current value of a wire.
 * - outline 
 *   Indicates the outline of a component.
 * - hide-when-running 
 *   These elements are only shown when the simulation unstarted or done.
 * - hide-when-not-running 
 *   These elements are only shown when the simulation is running
 * - powered 
 *   This class is added in JS. Indicates a wire that is high.
 * 
 * ## Data attributes
 * - data-show-on-value -- Used in muxes to make a wire showing which input is being used. 
 */

/** 
 * Describe an element in the datapath and how to render it.
 */
export interface DataPathElem {
	description?: string, // a description shown in the tooltip.
	hideDescriptionWhenRunning?: boolean // if the description is redundant when the value is being shown.
	label?: (sim: Simulator) => string, // the current value to display in a textbox
	tooltip?: (sim: Simulator) => string, // the current value with explanation shown in the tooltip.
	powered?: (sim: Simulator) => boolean, // return true if a wire is "powered" (powered wires will colored)
	onclick?: (visSim: VisualSim) => void, // call when an element is clicked
	// return a value, and will show matching elements under this element that marked with value in `data-show-on-value`
	showSubElemsByValue?: (sim: Simulator) => string,
	callback?: (visSim: VisualSim) => void, // arbitrary callback on each update.
}




/** Returns html showing num as hex, signed, and unsigned */
export function intToAll(num: bigint | Bits, bits: number = 32): string {
	let radices = [["Hex", "hex"], ["Unsigned", "unsigned"], ["Signed", "signed"]]
	let lines = radices.map(([l, r]) => `${l}: ${intToStr(num, r, bits)}`)
	return lines.join("<br/>")
}

const opCodeNames = new TruthTable([
	[["0110011"], "R-format"],
	[["0010011"], "I-format"],
	[["0000011"], "ld"],
	[["0100011"], "st"],
	[["1100011"], "branch"],
	[["1100111"], "jalr"],
	[["1101111"], "jal"],
	[["0110111"], "lui"],
])

const aluControlNames = new TruthTable([
	[["000", "0"], "Add"],
	[["000", "1"], "Sub"],
	[["001", "X"], "Shift Left"],
	[["010", "X"], "Set Less Than"],
	[["011", "X"], "Set Less Than (unsigned)"],
	[["100", "X"], "Xor"],
	[["101", "0"], "Shift Right (logical)"],
	[["101", "1"], "Shift Right (arithmetic)"],
	[["110", "X"], "Or"],
	[["111", "X"], "And"],
])

const aluSummaries = new TruthTable<(a: Bits, b: Bits) => string>([
	[["000", "0"], (a, b) => `${intToStr(a, "hex")} + ${intToStr(b, "hex")}`],
	[["000", "1"], (a, b) => `${intToStr(a, "hex")} - ${intToStr(b, "hex")}`],
	[["001", "X"], (a, b) => `${intToStr(a, "hex")} << ${intToStr(b, "unsigned")}`],
	[["010", "X"], (a, b) => `${intToStr(a, "signed")} < ${intToStr(b, "signed")}`],
	[["011", "X"], (a, b) => `${intToStr(a, "unsigned")} < ${intToStr(b, "unsigned")}`],
	[["100", "X"], (a, b) => `${intToStr(a, "hex")} XOR ${intToStr(b, "hex")}`],
	[["101", "0"], (a, b) => `${intToStr(a, "hex")} >> ${intToStr(b, "unsigned")}`],
	[["101", "1"], (a, b) => `${intToStr(a, "hex")} >>> ${intToStr(b, "unsigned")}`],
	[["110", "X"], (a, b) => `${intToStr(a, "hex")} OR ${intToStr(b, "hex")}`],
	[["111", "X"], (a, b) => `${intToStr(a, "hex")} AND ${intToStr(b, "hex")}`],
])

const writeSrcNames = new TruthTable([
	[["00"], "Data Memory"],
	[["01"], "ALU Result"],
	[["10"], "PC + 4"],
	[["11"], "Immediate Value"],
])


/** All the elements in the datapath and how to render them, tooltips, etc. */
export const datapathElements: Record<string, DataPathElem> = {
	// State Machine bold states
	"statesBold": {
		showSubElemsByValue: (sim) => intToStr(BigInt(sim.controlFSM.state), "unsigned"),
	},
	// State machine arrows
	"ExReg": {
		powered: (sim) => sim.controlFSM.skip_mem == 1,
	},
	"RegFetch": {
		powered: (sim) => sim.controlFSM.state == 4,
	},
	"MemReg": {
		powered: (sim) => sim.controlFSM.state == 3,
	},
	"ExMem": {
		powered: (sim) => sim.controlFSM.state == 2 && sim.controlFSM.skip_mem == 0,
	},
	"DecEx": {
		powered: (sim) => sim.controlFSM.state == 1,
	},
	"FetchDec": {
		powered: (sim) => sim.controlFSM.state == 0,
	},
	// Muxes
	"aluSrcMux1": {
		description: "Switch between the PC (0) and the first source register (1)",
		showSubElemsByValue: (sim) => intToStr(BigInt(sim.wires.aluSrc1), "unsigned"),
	},
	"aluSrcMux2": {
		description: "Switch between the immediate (0) and the second source register (1)",
		showSubElemsByValue: (sim) => intToStr(BigInt(sim.wires.aluSrc2), "unsigned"),
	},
	"pcMux": {
		description: "Switch between the branch target (0) or PC + 4 (1)",
		showSubElemsByValue: (sim) => intToStr(BigInt(sim.wires.pcSrc), "unsigned"),
	},
	"writeSrcMux": {
		description: "Switch between the read data (0), ALU result (1), PC + 4 (2), or the immediate (3)",
		showSubElemsByValue: (sim) => intToStr(BigInt(sim.wires.writeDataMuxSrc), "unsigned"),
	},
	"jalrMux": {
		description: "Switch between PC (0) or first source register (1)",
		showSubElemsByValue: (sim) => intToStr(BigInt(sim.wires.jumpControlSrc), "unsigned"),
	},
	// Control Wires
	"pcLoad": {
		description: "Load the new PC value",
		powered: (sim) => sim.wires.loadPC == 1,
	},
	"branchNotZero": {
		description: "Whether to branch when ALU result is not zero",
		powered: (sim) => sim.wires.branchNotZero == 1,
	},
	"branchZero": {
		description: "Whether to branch when ALU result is zero",
		powered: (sim) => sim.wires.branchZero == 1,
	},
	"branchBaseSrc": {
		description: "Whether to branch on the PC (0) or the first source register (1)",
		powered: (sim) => sim.wires.jumpControlSrc == 1,
	},
	"aluCalc": {
		description: "Load the new ALU inputs",
		powered: (sim) => sim.wires.aluCalc == 1,
	},
	"aluOp": {
		tooltip: (sim) => `Current ALU Op: ${intToStr(BigInt(sim.wires.aluOp), "bin", 4) + (sim.wires.aluAlt == 0 ? "0" : "1")} (${aluControlNames.match(sim.wires.aluOp, sim.wires.aluAlt)})`,
	},
	"aluSrc": {
		tooltip: (sim) => `ALU Sources: ${sim.wires.aluSrc1 == 0 ? "PC" : "Reg 1"}, ${sim.wires.aluSrc2 == 0 ? "Immediate" : "Reg 2"}`,
	},
	"memFormat": {
		tooltip: (sim) => `Memory Format: ${(sim.wires.memUnsigned == 0 ? "Signed" : "Unsigned") + (sim.wires.memSize == 0 ? " Byte" : (sim.wires.memSize == 1 ? " Halfword" : " Word"))}`,
	},
	"memWrite": {
		description: "Whether to write to memory",
		powered: (sim) => sim.wires.memWrite == 1,
	},
	"loadInstr": {
		description: "Load the new instruction",
		powered: (sim) => sim.wires.loadInstr == 1,
	},
	"regWrite": {
		description: "Whether to write to the register file",
		powered: (sim) => sim.wires.regWrite == 1,
	},
	"writeDataMuxSrc": {
		tooltip: (sim) => `Reg Write Data Source: ${writeSrcNames.match(sim.wires.writeDataMuxSrc)}`,
	},
	// Instruction Wires
	"opcodeWire": {
		tooltip: (sim) => `Opcode: ${intToStr(Bits.toInt(sim.wires.opcode), "bin", 7)} (${opCodeNames.match(sim.wires.opcode)})`,
	},
	"funct3Wire": {
		tooltip: (sim) => `Funct3: ${intToStr(Bits.toInt(sim.wires.funct3), "bin", 3)}`,
	},
	"funct7Wire": {
		tooltip: (sim) => `Funct7: ${intToStr(Bits.toInt(sim.wires.funct7), "bin", 7)}`,
	},
	"rs1Wire": {
		tooltip: (sim) => `Source Register 1: ${intToStr(Bits.toInt(sim.wires.readReg1), "bin", 5)} (${registerNames[Number(Bits.toInt(sim.wires.readReg1))]})`,
	},
	"rs2Wire": {
		tooltip: (sim) => `Source Register 2: ${intToStr(Bits.toInt(sim.wires.readReg2), "bin", 5)} (${registerNames[Number(Bits.toInt(sim.wires.readReg2))]})`,
	},
	"writeRegWire": {
		tooltip: (sim) => `Write Register: ${intToStr(Bits.toInt(sim.wires.writeReg), "bin", 5)} (${registerNames[Number(Bits.toInt(sim.wires.writeReg))]})`,
	},
	"immediateWire": {
		tooltip: (sim) => `Immediate: ${intToStr(Bits.toInt(sim.wires.immediate), "hex")}`,
	},
	// Jump Control Wires
	"pcSrc": {
		powered: (sim) => sim.wires.pcSrc == 1,
	},
	"jumpZeroWire": {
		powered: (sim) => sim.wires.branchZero == 1 && sim.wires.aluZero == 1,
	},
	"jumpNZeroWire": {
		powered: (sim) => sim.wires.branchNotZero == 1 && sim.wires.aluZero == 0,
	},
	// Component + Wire tooltips
	"pc": {
		description: "The program counter stores the address of the current instruction.",
		tooltip: (sim) => `Current Instruction Addr: ${intToStr(sim.pc.val, "hex")}`,
	},
	"pcInc": {
		description: "Increment the program counter to the next instruction",
		tooltip: (sim) => `PC + 4 = ${intToStr(sim.wires.pcVal4, "hex")}`,
	},
	"addrCalc": {
		description: "Calculates the target jump address",
		tooltip: (sim) => `Target Addr: ${intToStr(sim.wires.jumpAddr, "hex")}`,
	},
	"ir": {
		description: "The instruction register stores the current instruction.",
		tooltip: (sim) => `Current Instruction: ${intToStr(sim.instructionMemory.instr_delayed, "hex")}`,
	},
	"in1FF": {
		tooltip: (sim) => `ALU Input 1: ${intToStr(sim.alu.in1_delayed, "hex")}`,
	},
	"in2FF": {
		tooltip: (sim) => `ALU Input 2: ${intToStr(sim.alu.in2_delayed, "hex")}`,
	},
	"alu": {
		description: "The Arithmetic Logic Unit performs the cpu's arithmetic operations",
		tooltip: (sim) => `${aluSummaries.match(sim.alu.op_delayed, sim.alu.alt_delayed)(sim.alu.in1_delayed, sim.alu.in2_delayed)
			} = ${intToStr(sim.wires.aluOut, "hex")}<br/>Zero: ${sim.wires.aluZero}`,
	},
	"dataMem": {
		description: "Stores the data the program is working with.",
		tooltip: (sim) => `Data Memory: ${intToStr(sim.ram.last_data_read, "hex")}`,
	},
	"registers": {
		description: "Stores the 32 register values",
		tooltip: (sim) => `Read Registers: ${registerNames[Number(Bits.toInt(sim.wires.readReg1))]}, ${registerNames[Number(Bits.toInt(sim.wires.readReg2))]}<br/>
Read Data: ${intToStr(sim.wires.readData1, "hex")}, ${intToStr(sim.wires.readData2, "hex")}<br/>
Write Register: ${registerNames[Number(Bits.toInt(sim.wires.writeReg))]}<br/>
Write Data: ${intToStr(sim.wires.writeData, "hex")}`,
	},
	// Components
	"instrMem": {
		description: "Stores all of the instructions for the program",
	},
} 