import { Parser, Grammar } from 'nearley';
import * as moo from 'moo';
import { Bit, Bits, b } from "utils/bits"
import { registers, opcodes } from "simulator/constants";
import grammar from './assembler.ne';

interface Program { instructions: [number, bigint][], data: [number, bigint][], machineCode: bigint[] };

// AST types that are returned from the parser.
interface Arg { type: string, value: any }
type DirectiveArg = DirectiveString | DirectiveNumber;
interface DirectiveString { type: "any", value: string }
interface DirectiveNumber { type: "num", value: bigint }
type AsmStatement = AsmLabel | AsmDirective | AsmInstr
interface AsmLabel {
   type: "label"; label: string
}
interface AsmDirective {
   type: "directive",
   directive: string,
   line: number,
   args: DirectiveArg[],
}
interface AsmInstr {
   type: "basic" | "displacement" | "argless",
   line: number,
   op: string; args: Arg[]
}

// Represents each instruction type
type Instr = RType | IType | ISType | SType | SBType | UType | UJype
interface RType { type: "R", line: number, op: string, rd: string, rs1: string, rs2: string; }
interface IType { type: "I", line: number, op: string, rd: string, rs1: string, imm: number | string } // string imm is a label
// Shifts use a specialized I format, with 5 bit imm and funct7. There's no official name, so we'll just call the format "IS"
interface ISType { type: "IS", line: number, op: string, rd: string, rs1: string, imm: number | string }
interface SType { type: "S", line: number, op: string, rs1: string, rs2: string, imm: number | string }
interface SBType { type: "SB", line: number, op: string, rs1: string, rs2: string, imm: number | string }
interface UType { type: "U", line: number, op: string, rd: string, imm: number | string }
interface UJype { type: "UJ", line: number, op: string, rd: string, imm: number | string }

type Directive = SizedData | Align;
interface SizedData { data: bigint[], align: number }
interface Align { align: number }

function directiveMatch(directive: AsmDirective): Directive {
   const sizedData = new Map([[".byte", 1], [".half", 2], [".word", 4], [".dword", 8]]);
   const string = [".string"];
   const align = [".align"];
   if (sizedData.has(directive.directive)) {
      if (directive.args.length == 1 && directive.args[0].type == "num") {
         let size = sizedData.get(directive.directive) as number;
         let value = directive.args[0].value;
         if (value > 2n ** (8n * BigInt(size))) throw Error("Value can't fit in " + size + " bytes");
         let data = [];
         for (let i = 0; i < size; i++) {
            data.push(value & 0xFFn);
            value >>= 8n;
         }
         return { data: data, align: size }
      } else {
         throw Error("Invalid argument for " + directive.directive);
      }
   } else if (string.includes(directive.directive)) {
      if (directive.args.length == 1 && directive.args[0].type == "any") {
         let s = directive.args[0].value.substring(1, directive.args[0].value.length - 1); // Remove quotes
         let data = [];
         for (let char of s) {
            data.push(BigInt(char.charCodeAt(0)));
         }
         data.push(0n); // null terminator
         return { data: data, align: 4 }
      } else {
         throw Error("Invalid argument for " + directive.directive);
      }
   } else if (align.includes(directive.directive)) {
      if (directive.args.length == 1 && directive.args[0].type == "num") {
         return { align: Number(directive.args[0].value) }
      } else {
         throw Error("Invalid argument for " + directive.directive);
      }
   } else {
      throw Error("Unknown directive")
   }
}

/** Contains rules for the args and types of instructions and how to convert them. */
interface Rule {
   instructions: string[]
   format: "basic" | "displacement" | "argless"
   signature: string[],
   conv: (op: string, args: any[], line: number) => Instr
}

function ruleMatch(rule: Rule, instr: AsmInstr) {
   return (rule.instructions.includes(instr.op.toLowerCase())) &&
      (instr.type == rule.format) && (instr.args.length == rule.signature.length) &&
      instr.args.every((arg, i) => rule.signature[i] == 'any' || arg.type == rule.signature[i])
}

const instrRules: Rule[] = [
   {
      instructions: ["add", "sub", "and", "or", "xor", "sll", "sra", "srl", "slt", "sltu"],
      format: "basic",
      signature: ["id", "id", "id"],
      conv: (op, [rd, rs1, rs2], line) => ({ type: "R", op: op, rd: rd, rs1: rs1, rs2: rs2, line: line }),
   }, {
      instructions: ["addi", "andi", "ori", "xori", "slti", "sltiu"],
      format: "basic",
      signature: ["id", "id", "any"],
      conv: (op, [rd, rs1, imm], line) => ({ type: "I", op: op, rd: rd, rs1: rs1, imm: imm, line: line }),
   }, {
      instructions: ["slli", "srai", "srli"], // shifts are stored as a specialized I-format, 
      format: "basic",
      signature: ["id", "id", "num"],
      conv: (op, [rd, rs1, imm], line) => ({ type: "IS", op: op, rd: rd, rs1: rs1, imm: imm, line: line }),
   }, {
      instructions: ["beq", "bge", "bgeu", "blt", "bltu", "bne"],
      format: "basic",
      signature: ["id", "id", "id"],
      conv: (op, [rs1, rs2, label], line) => ({ type: "SB", op: op, rs1: rs1, rs2: rs2, imm: label, line: line }),
   }, {
      instructions: ["jal"],
      format: "basic",
      signature: ["id", "any"],
      conv: (op, [rd, offset], line) => ({ type: "UJ", op: op, rd: rd, imm: offset, line: line }),
   }, {
      instructions: ["jal"],
      format: "basic",
      signature: ["any"],
      conv: (op, [offset], line) => ({ type: "UJ", op: op, rd: "ra", imm: offset, line: line }),
   }, {
      instructions: ["j"],
      format: "basic",
      signature: ["id"],
      conv: (op, [label], line) => ({ type: "UJ", op: "jal", rd: "zero", imm: label, line: line }),
   }, {
      instructions: ["lui", "auipc"],
      format: "basic",
      signature: ["id", "any"],
      conv: (op, [rd, imm], line) => ({ type: "U", op: op, rd: rd, imm: imm, line: line }),
   }, {
      instructions: ["lb", "lbu", "lh", "lhu", "lw", "jalr"],
      format: "displacement",
      signature: ["id", "num", "id"],
      conv: (op, [rd, imm, rs1], line) => ({ type: "I", op: op, rd: rd, rs1: rs1, imm: imm, line: line }),
   }, {
      instructions: ["sb", "sh", "sw"],
      format: "displacement",
      signature: ["id", "num", "id"],
      conv: (op, [rs2, imm, rs1], line) => ({ type: "S", op: op, rs1: rs1, rs2: rs2, imm: imm, line: line }),
   }, {
      instructions: ["mv"],
      format: "basic",
      signature: ["id", "id"],
      conv: (op, [rd, rs1], line) => ({ type: "I", op: "addi", rd: rd, rs1: rs1, imm: 0, line: line }),
   }, {
      instructions: ["li"], // Does not support greater than 12-bit immediates. You have to `lui` and `li` yourself
      format: "basic",
      signature: ["id", "any"],
      conv: (op, [rd, imm], line) => ({ type: "I", op: "addi", rd: rd, rs1: "zero", imm: imm, line: line }),
   }, {
      instructions: ["halt"],
      format: "argless",
      signature: [],
      conv: (op, [], line) => ({ type: "UJ", op: "jal", rd: "zero", imm: 0, line: line }),
   }, {
      instructions: ["nop"],
      format: "argless",
      signature: [],
      conv: (op, [], line) => ({ type: "I", op: "addi", rd: "zero", rs1: "zero", imm: 0, line: line }),
   }, {
      instructions: ["ret"],
      format: "argless",
      signature: [],
      conv: (op, [], line) => ({ type: "I", op: "jalr", rd: "zero", rs1: "ra", imm: 0, line: line }),
   }
];

/**
 * Parses the program using nearley, throws an error if nearley fails.
 * Doesn't check registers, labels, etc.
 */
function parse(program: string): AsmStatement[] {
   let parser = new Parser(Grammar.fromCompiled(grammar));

   try {
      parser.feed(program);
   } catch (e: any) {
      throw new AssemblerError("Syntax error", program, e.token.line, e.token.col)
   }
   if (parser.results.length < 1) {
      let lines = program.split("\n")
      throw new AssemblerError(`Unexpected end of program`, program, lines.length, lines[lines.length - 1].length)
   } else if (parser.results.length > 1) {
      throw Error("Code is ambiguous.") // This shouldn't be possible
   }
   return parser.results[0]
}

/**
 * Assembles a RISC-V assembly program.
 * Returns a list of [lineNum, machineCodeInstruction] tuples, where lineNum is the 1 indexed line in the string.
 */
export function assembleKeepLineInfo(program: string): Program {
   let parsed = parse(program)

   let labels: Record<string, number> = {}
   let instructions: Instr[] = [];
   let directives: [Directive, number][] = [];
   let instrMem: [number, bigint][] = [];
   let dataMem: [number, bigint][] = [];
   let machineCode: bigint[] = [];

   // Pass 1, read labels, convert AST into Instruction types
   for (let instr of parsed) {
      if (instr.type == "label") {
         labels[instr.label] = instructions.length // Point to next instruction
      } else if (instr.type == "directive") {
         let directive = directiveMatch(instr);
         directives.push([directive, instr.line]);
      } else {
         let matchingRule = instrRules.find(r => ruleMatch(r, instr as AsmInstr))
         if (matchingRule) {
            let newInstr = matchingRule.conv(instr.op.toLowerCase(), instr.args.map((a) => a.value), instr.line)
            instructions.push(newInstr)
         } else {
            throw new AssemblerError("Unknown instruction or incorrect args", program, instr.line)
         }
      }
   }

   // Pass 2, actually assemble the assembly
   let i = 0;
   let d = 0;
   let offset = 0;
   let align = 0;
   while (i < instructions.length || d < directives.length) {
      // Insert an instruction next
      if (d >= directives.length || (i < instructions.length && instructions[i].line < directives[d][1])) {
         let instr = instructions[i];
         try {
            var machineCodeInstr = assembleInstr(machineCode.length, instr, labels)
         } catch (e: any) {
            throw new AssemblerError(e.message, program, instr.line)
         }
         machineCode.push(Bits.toInt(machineCodeInstr));
         instrMem.push([instr.line, Bits.toInt(machineCodeInstr)]);
         i++;
      }
      // Insert a directive next
      else {
         let [directive, _] = directives[d];
         let a;
         if (align != 0)
            a = align;
         else
            a = directive.align;

         // Data directive (byte, word, string, etc...)
         if ("data" in directive) {
            offset += (a - (offset % a)) % a;
            offset %= 4;

            for (let data of directive.data) {
               if (offset == 0) {
                  machineCode.push(0n);
                  dataMem.push([machineCode.length - 1, 0n]);
               }

               machineCode[machineCode.length - 1] |= data << (BigInt(offset) * 8n);
               dataMem[dataMem.length - 1][1] |= data << (BigInt(offset) * 8n);
               offset += 1;
               offset %= 4;
            }
         }
         // Alignment directive
         else {
            align = directive.align;
         }
         d++;
      }
   }

   return { instructions: instrMem, data: dataMem, machineCode: machineCode };
}

/** Assembles a single instruction. */
function assembleInstr(instrNum: number, instr: Instr, labels: Record<string, number>): Bits {
   let temp: any = { ...instr } // Copy instr into an any so we can store Bits and BigInts in it.
   if ("imm" in instr && typeof instr.imm == "string") {
      if (!(instr.imm in labels)) throw Error(`Unknown label "${temp.imm}"`)
      temp.imm = (labels[instr.imm] - instrNum) * 4;
   }
   for (let field of ["rd", "rs1", "rs2"]) {
      if (field in temp) {
         if (!(temp[field] in registers))
            throw Error(`Unknown register "${temp[field]}"`)
         temp[field] = Bits(registers[temp[field]], 5)
      }
   }

   let [opcode, funct3, funct7] = opcodes[instr.op]
   if (instr.type == "R") {
      return Bits.join(funct7, temp.rs2, temp.rs1, funct3, temp.rd, opcode)
   } else if (instr.type == "I") {
      return Bits.join(Bits(temp.imm, 12, true), temp.rs1, funct3, temp.rd, opcode)
   } else if (instr.type == "IS") {
      return Bits.join(funct7, Bits(temp.imm, 5, true), temp.rs1, funct3, temp.rd, opcode)
   } else if (instr.type == "S") {
      let imm = Bits(temp.imm, 12, true)
      return Bits.join(imm.slice(5, 12), temp.rs2, temp.rs1, funct3, imm.slice(0, 5), opcode)
   } else if (instr.type == "SB") {
      let imm = Bits(temp.imm, 13, true)
      return Bits.join(imm[12], imm.slice(5, 11), temp.rs2, temp.rs1, funct3, imm.slice(1, 5), imm[11], opcode)
   } else if (instr.type == "U") {
      return Bits.join(Bits(temp.imm, 20, true), temp.rd, opcode)
   } else if (instr.type == "UJ") {
      let imm = Bits(temp.imm, 21, true)
      return Bits.join(imm[20], imm.slice(1, 11), imm[11], imm.slice(12, 20), temp.rd, opcode)
   } else {
      throw Error("Unknown instruction type")
   }
}


/** Assembler error. Shows message and line number with a preview */
class AssemblerError extends Error {
   line: number; col?: number;

   constructor(message: string, program: string, line: number, col?: number) {
      let lines = program.split("\n")
      let preview = lines[line - 1].trimLeft()
      let whitespace = lines[line - 1].length - preview.length
      if (col != undefined) {
         message = `${message}\n` +
            `at line ${line} col ${col}:\n` +
            `  ${preview}\n` +
            `  ${'-'.repeat(col - 1 - whitespace)}^`
      } else {
         message = `${message}\n` +
            `at line ${line}:\n` +
            `  ${preview}\n`
      }

      super(message);
      // Hack to allow extending error. https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html#support-for-newtarget
      Object.setPrototypeOf(this, new.target.prototype);
      this.line = line; this.col = col;
   }
}