import { Memory } from "./memory"
import { Bit, Bits, b } from "utils/bits"
import { TruthTable } from "utils/truthTable"

enum MemSize {
   Byte,
   HalfWord,
   Word,
}
enum State {
   FETCH,
   DECODE,
   EXECUTE,
   MEMORY,
   WRITEBACK,
}
enum ALUOp {
   Add,
   ShiftLeft,
   SetLessThan,
   SetLessThanUnsigned,
   Xor,
   ShiftRight,
   Or,
   And,
}
enum WriteDataSrc {
   ALUOut,
   MemRead,
   PC4,
   Imm,
}
enum ALUSrc1 {
   Reg1,
   PC
}
enum ALUSrc2 {
   Reg2,
   Imm
}
enum PCSrc {
   PC4,
   JumpControl,
}
enum JumpControlSrc {
   PCImm,
   RS1Imm,
}
enum MemAddrSrc {
   PC,
   ALUOut
}

export interface Component {
   /**
    * Read inputs, update state, store outputs
    */
   rising_edge(): void
   /**
    * Update outputs
    */
   falling_edge(): void
   /**
    * Reset the outputs to a valid state
    */
   reset_outputs(): void
}

export class EndOfProgram extends Error { }

/**
 * Components should be run in this order:
 * 1. Control
 * 2. Muxes
 * 3. Everything else
 */

export class Wires {
   // Instruction Memory
   /* Set By Control */
   public loadInstr: Bit = 0;
   // intr = memReadData
   /* Set By Instruction Memory */
   public opcode: Bits = []; // 7 bits
   public funct3: Bits = []; // 3 bits
   public funct7: Bits = []; // 7 bits
   public immediate: Bits = []; // 32 bits

   // RAM
   /* Set By Control */
   public memWrite: Bit = 0;
   public memSize: MemSize = 0; // 2 bits (byte/half-word/word)
   public memUnsigned: Bit = 0; // 1 bit (whether to sign extend the output from memory)
   /* Set By MemAddrMux */
   public memAddress: Bits = []; // 32 bits
   // writeData = reg2
   /* Set By RAM */
   public memReadData: Bits = []; // 32 bits

   // PC
   /* Set By PC */
   public pcVal: Bits = Bits(0n, 32); // 32 bits
   public pcVal4: Bits = Bits(4n, 32); // 32 bits
   /* Set By PCSrcMux */
   public pcIn: Bits = []; // 32 bits
   /* Set By Control */
   public loadPC: Bit = 0;

   // Jump Control
   /* Set By Control */
   public branchZero: Bit = 0;
   public branchNotZero: Bit = 0;
   public jumpControlSrc: JumpControlSrc = 0; // 1 bit
   /* Set By Jump Control */
   public jumpAddr: Bits = []; // 32 bits

   // ALU
   /* Set By Control */
   public aluOp: ALUOp = 0; // 4 bits
   public aluAlt: Bit = 0;
   public aluCalc: Bit = 0;
   /* Set By ALUSrcMux1 File */
   public aluIn1: Bits = []; // 32 bits
   /* Set By ALUSrcMux2 */
   public aluIn2: Bits = []; // 32 bits
   /* Set By ALU */
   public aluOut: Bits = []; // 32 bits
   public aluZero: Bit = 0;

   // Register File
   /* Set By Instruction Memory */
   public readReg1: Bits = []; // 5 bits
   public readReg2: Bits = []; // 5 bits
   public writeReg: Bits = []; // 5 bits
   /* Set By Register File */
   public readData1: Bits = []; // 32 bits
   public readData2: Bits = []; // 32 bits
   /* Set By WriteDataMux */
   public writeData: Bits = []; // 32 bits
   /* Set By Control */
   public regWrite: Bit = 0;

   // WriteDataMux
   /* Set By Control */
   public writeDataMuxSrc: WriteDataSrc = 0; // 2 bits

   // ALUSrc1Mux
   /* Set By Control */
   public aluSrc1: ALUSrc1 = 0; // 2 bits

   // ALUSrc2Mux
   /* Set By Control */
   public aluSrc2: ALUSrc2 = 0; // 1 bit

   // PCSrcMux
   /* Set By Jump Control */
   public pcSrc: PCSrc = 0; // 1 bit

   // MemAddrMux
   /* Set By Control */
   public memAddrMuxSrc: MemAddrSrc = 0; // 1 bit
}

export class ControlFSM implements Component {
   public state: State = State.FETCH;
   private wires: Wires;

   /*
   Signals:
      Instruction Memory:
         loadInstr
      RAM:
         memWrite
         memSize
         memUnsigned
      PC:
         loadPC
      Jump Control:
         branchZero
         branchNotZero
         jumpControlSrc
      ALU:
         aluOp
         aluAlt
         aluCalc
      Register File:
         regWrite
      WriteDataMux:
         writeDataMuxSrc
      ALUSrc1Mux:
         aluSrc1
      ALUSrc2Mux:
         aluSrc2
      MemAddrMux:
         memAddrMuxSrc
   */

   // Takes opcode
   // Returns [aluAlt, aluOp, aluSrc1, aluSrc2, aluCalc]
   private static alu_table = new TruthTable<[(funct3: Bits, funct7: Bits) => [Bit, ALUOp], ALUSrc1, ALUSrc2, Bit]>([
      // R Type: funct7[5] determines add/sub and srl/sra. funct3 is always the same as the ALUOp
      [["0110011"], [(funct3, funct7) => [funct7[5], Bits.toNumber(funct3) as ALUOp], ALUSrc1.Reg1, ALUSrc2.Reg2, 1]],
      // I Type: Same as R type, funct3 determines the ALU op exactly. No weirdness with aluAlt this time
      [["0010011"], [(funct3, _7) => [0, Bits.toNumber(funct3) as ALUOp], ALUSrc1.Reg1, ALUSrc2.Imm, 1]],
      // AUIPC
      [["0010111"], [(_3, _7) => [0, ALUOp.Add], ALUSrc1.PC, ALUSrc2.Imm, 1]],
      // Load/Store
      [["0X00011"], [(_3, _7) => [0, ALUOp.Add], ALUSrc1.Reg1, ALUSrc2.Imm, 1]],
      // Branch: funct3[1:2] determines the ALUOp
      [["1100011"], [(funct3, _7) => [1, Bits.toNumber(funct3.slice(1, 3)) as ALUOp], ALUSrc1.Reg1, ALUSrc2.Reg2, 1]],
      // JALR
      [["1100111"], [(_3, _7) => [0, ALUOp.Add], ALUSrc1.Reg1, ALUSrc2.Imm, 1]],
      // JAL
      [["1101111"], [(_3, _7) => [0, ALUOp.Add], ALUSrc1.PC, ALUSrc2.Imm, 1]],
      // Anything else doesn't use the ALU, so return default values
      [["XXXXXXX"], [(_3, _7) => [0, ALUOp.Add], ALUSrc1.Reg1, ALUSrc2.Reg2, 0]],
   ]);

   // Takes opcode, funct3
   // Returns [memWrite, memAddrMuxSrc, memSize, memUnsigned]
   private static memory_table = new TruthTable<[Bit, MemAddrSrc, MemSize, Bit]>([
      // Load
      [["0000011", "000"], [0, MemAddrSrc.ALUOut, MemSize.Byte, 0]],
      [["0000011", "001"], [0, MemAddrSrc.ALUOut, MemSize.HalfWord, 0]],
      [["0000011", "X10"], [0, MemAddrSrc.ALUOut, MemSize.Word, 0]], // Word isn't sign extended, so sign doesn't matter
      [["0000011", "100"], [0, MemAddrSrc.ALUOut, MemSize.Byte, 1]],
      [["0000011", "101"], [0, MemAddrSrc.ALUOut, MemSize.HalfWord, 1]],
      // Store
      [["0100011", "000"], [1, MemAddrSrc.ALUOut, MemSize.Byte, 0]],
      [["0100011", "001"], [1, MemAddrSrc.ALUOut, MemSize.HalfWord, 0]],
      [["0100011", "010"], [1, MemAddrSrc.ALUOut, MemSize.Word, 0]],
      // Anything else doesn't use memory, so return default values
      [["XXXXXXX", "XXX"], [0, MemAddrSrc.PC, MemSize.Word, 0]],
   ]);

   // Takes opcode
   // Returns [regWrite, writeDataMuxSrc]
   private static register_table = new TruthTable<[Bit, WriteDataSrc]>([
      // R or I Type
      [["0X10011"], [1, WriteDataSrc.ALUOut]],
      // AUIPC
      [["0010111"], [1, WriteDataSrc.ALUOut]],
      // LUI
      [["0110111"], [1, WriteDataSrc.Imm]],
      // Load
      [["0000011"], [1, WriteDataSrc.MemRead]],
      // Jump
      [["110X111"], [1, WriteDataSrc.PC4]],
      // Doesn't write to a register
      [["XXXXXXX"], [0, WriteDataSrc.ALUOut]],
   ]);

   // Takes opcode, funct3
   // Returns [branchZero, branchNotZero, jumpControlSrc
   private static jump_table = new TruthTable<[Bit, Bit, JumpControlSrc]>([
      [["1100111", "XXX"], [1, 1, JumpControlSrc.RS1Imm]], // JALR
      [["1101111", "XXX"], [1, 1, JumpControlSrc.PCImm]], // JAL
      [["1100011", "000"], [1, 0, JumpControlSrc.PCImm]], // BEQ
      [["1100011", "001"], [0, 1, JumpControlSrc.PCImm]], // BNE
      [["1100011", "100"], [0, 1, JumpControlSrc.PCImm]], // BLT
      [["1100011", "101"], [1, 0, JumpControlSrc.PCImm]], // BGE
      [["1100011", "110"], [0, 1, JumpControlSrc.PCImm]], // BLTU
      [["1100011", "111"], [1, 0, JumpControlSrc.PCImm]], // BGEU
      [["XXXXXXX", "XXX"], [0, 0, JumpControlSrc.PCImm]], // Not a Jump
   ]);

   constructor(wires: Wires) {
      this.wires = wires;
   }

   /**
    * Control FSM can break the rules, because it needs to be special in order to work. Because of this, it must be run first.
    */
   rising_edge() {
      this.reset_outputs();

      if (this.state == State.FETCH) {
         // Load next instruction, so it's ready next cycle
         this.wires.memSize = MemSize.Word;
         this.wires.memAddrMuxSrc = MemAddrSrc.PC;
      }
      else if (this.state == State.DECODE) {
         // Memory is outputting the instruction, so tell instruction memory to load it
         this.wires.loadInstr = 1;
      }
      else if (this.state == State.EXECUTE) {
         // Set up ALU
         let [func, aluSrc1, aluSrc2, aluCalc] = ControlFSM.alu_table.match(this.wires.opcode);
         let [aluAlt, aluOp] = func(this.wires.funct3, this.wires.funct7);
         this.wires.aluAlt = aluAlt;
         this.wires.aluOp = aluOp;
         this.wires.aluSrc1 = aluSrc1;
         this.wires.aluSrc2 = aluSrc2;
         this.wires.aluCalc = aluCalc;
      }
      else if (this.state == State.MEMORY) {
         // Write to or read from memory
         let [memWrite, memAddrMuxSrc, memSize, memUnsigned] = ControlFSM.memory_table.match(this.wires.opcode, this.wires.funct3);
         this.wires.memWrite = memWrite;
         this.wires.memAddrMuxSrc = memAddrMuxSrc;
         this.wires.memSize = memSize;
         this.wires.memUnsigned = memUnsigned;
      }
      else if (this.state == State.WRITEBACK) {
         // Write to register file
         let [regWrite, writeDataMuxSrc] = ControlFSM.register_table.match(this.wires.opcode, this.wires.funct3);
         this.wires.regWrite = regWrite;
         this.wires.writeDataMuxSrc = writeDataMuxSrc;

         // Set up jump controller
         let [branchZero, branchNotZero, jumpControlSrc] = ControlFSM.jump_table.match(this.wires.opcode, this.wires.funct3);
         this.wires.branchZero = branchZero;
         this.wires.branchNotZero = branchNotZero;
         this.wires.jumpControlSrc = jumpControlSrc;

         // Inc/branch PC (determined by jump control)
         this.wires.loadPC = 1;
      }
   }

   /**
    * Updates state based on the current state.
    * FETCH -> DECODE -> EXECUTE -> MEMORY -> WRITEBACK
    */
   falling_edge() {
      this.state = (this.state + 1) % 5;
   }

   // Resets all outputs, because this component is purely combinational
   reset_outputs() {
      this.wires.loadInstr = 0;
      this.wires.memWrite = 0;
      this.wires.memSize = MemSize.Word;
      this.wires.memUnsigned = 0;
      this.wires.loadPC = 0;
      this.wires.branchZero = 0;
      this.wires.branchNotZero = 0;
      this.wires.jumpControlSrc = JumpControlSrc.PCImm;
      this.wires.aluOp = ALUOp.Add;
      this.wires.aluAlt = 0;
      this.wires.aluCalc = 0;
      this.wires.regWrite = 0;
      this.wires.writeDataMuxSrc = WriteDataSrc.ALUOut;
      this.wires.aluSrc1 = ALUSrc1.Reg1;
      this.wires.aluSrc2 = ALUSrc2.Reg2;
      this.wires.memAddrMuxSrc = MemAddrSrc.PC;
   }
}

export class InstructionMemory implements Component {
   public instruction: Bits = Bits(0x0000_0013n, 32);
   private wires: Wires;

   private static immediate_table = new TruthTable<(i: Bits) => Bits>([
      // R-type -> no immediate
      [["0110011"], (i) => b`0`],
      // I-type -> imm[11:0] | rs1 | funct3 | rd
      [["00X0011"], (i) => i.slice(20, 32)],
      // I-type (JALR) -> imm[11:0] | rs1 | funct3 | rd
      [["1100111"], (i) => i.slice(20, 32)],
      // S-type -> imm[11:5] | rs2 | rs1 | funct3 | imm[4:0]
      [["0100011"], (i) => Bits.join(i.slice(25, 32), i.slice(7, 12))],
      // SB-type -> imm[12|10:5] | rs2 | rs1 | funct3 | imm[4:1|11]
      [["1100011"], (i) => Bits.join(i[31], i[7], i.slice(25, 31), i.slice(8, 12), 0)],
      // U-type -> imm[19:0] | rd | opcode
      [["0X10111"], (i) => Bits.join(i.slice(12, 32), Bits(0n, 12))],
      // UJ-type -> imm[20|10:1|11|19:12] | rd | opcode
      [["1101111"], (i) => Bits.join(i[31], i.slice(12, 20), i[20], i.slice(21, 31), 0)],
   ])

   constructor(wires: Wires) {
      this.wires = wires;
   }

   /**
    * Unfortunately, we have to do this on the rising edge because we need the register file to output rs1 and rs2 before the execute stage
    */
   rising_edge() {
      // Load the instruction from memory
      if (this.wires.loadInstr) {
         this.instruction = this.wires.memReadData;
      }

      // Check if we've encountered the end of the program (0x0000_0000)
      if (this.instruction.every(b => b == 0)) {
         throw new EndOfProgram();
      }

      this.wires.opcode = this.instruction.slice(0, 7);
      this.wires.writeReg = this.instruction.slice(7, 12);
      this.wires.funct3 = this.instruction.slice(12, 15);
      this.wires.readReg1 = this.instruction.slice(15, 20);
      this.wires.readReg2 = this.instruction.slice(20, 25);
      this.wires.funct7 = this.instruction.slice(25, 32);

      let imm_gen = InstructionMemory.immediate_table.match(this.wires.opcode);
      let imm = imm_gen(this.instruction);
      this.wires.immediate = Bits.extended(imm, 32, true);
   }

   falling_edge() { }

   reset_outputs() {
      this.wires.opcode = Bits(0n, 7);
      this.wires.writeReg = Bits(0n, 5);
      this.wires.funct3 = Bits(0n, 3);
      this.wires.readReg1 = Bits(0n, 5);
      this.wires.readReg2 = Bits(0n, 5);
      this.wires.funct7 = Bits(0n, 7);
      this.wires.immediate = Bits(0n, 32);
   }
}

export class RAM implements Component {
   public data: Memory;
   public readOutput: Bits = []; // 32 bits
   private wires: Wires;
   private static table = new TruthTable<number>([
      [["00"], 1], // byte
      [["01"], 2], // half-word
      [["10"], 4], // word
   ]);

   constructor(wires: Wires) {
      this.data = new Memory(2n ** 32n);
      this.wires = wires;
   }

   rising_edge() {
      let addr = Bits.toInt(this.wires.memAddress, false);
      let data = Bits.toInt(this.wires.readData2, false);
      let size = RAM.table.match(this.wires.memSize);

      if (this.wires.memWrite) {
         this.data.store(addr, size, data);
      }
      this.readOutput = Bits(this.data.load(addr, size), 32, false);
   }

   falling_edge() {
      this.wires.memReadData = this.readOutput;
   }

   reset_outputs() { }
}

export class PC implements Component {
   public val: Bits = Bits(0n, 32, false);
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.loadPC) {
         this.val = this.wires.pcIn;
      }
   }

   falling_edge() {
      this.wires.pcVal = this.val;

      let nextVal = Bits.toInt(this.val, false) + 4n;
      nextVal = nextVal & 0xFFFF_FFFFn; // Wrap in case of overflow
      this.wires.pcVal4 = Bits(nextVal, 32);
   }

   reset_outputs() { }
}

export class JumpControl implements Component {
   // Controls PCSrc and JumpAddr
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   // Combinational, so everything changes on rising edge
   rising_edge() {
      let shouldBranch = (this.wires.branchZero && this.wires.aluZero) || (this.wires.branchNotZero && !this.wires.aluZero);
      this.wires.pcSrc = shouldBranch ? PCSrc.JumpControl : PCSrc.PC4;

      let baseBits = this.wires.jumpControlSrc == JumpControlSrc.PCImm ? this.wires.pcVal : this.wires.readData1;
      let base = Bits.toInt(baseBits, false);
      let offset = Bits.toInt(this.wires.immediate, true);
      let jumpAddr = base + offset;

      this.wires.jumpAddr = Bits(jumpAddr, 33).slice(0, 32);
   }

   falling_edge() { }

   reset_outputs() { }
}

export class ALU implements Component {
   public output: Bits = Bits(0n, 32, true);
   private wires: Wires;


   private static table = new TruthTable<[boolean, (a: bigint, b: bigint) => bigint]>([
      [["000", "0"], [true, (a, b) => a + b]], // Add
      [["000", "1"], [true, (a, b) => a - b]], // Sub
      [["001", "X"], [true, (a, b) => a << (b & 0x1Fn)]], // Shift Left Logical
      [["010", "X"], [true, (a, b) => BigInt(a < b)]], // Set Less Than
      [["011", "X"], [false, (a, b) => BigInt(a < b)]], // Set Less Than Unsigned
      [["100", "X"], [true, (a, b) => a ^ b]], // Xor
      [["101", "0"], [false, (a, b) => a >> (b & 0x1Fn)]], // Shift Right Logical
      [["101", "1"], [true, (a, b) => a >> (b & 0x1Fn)]], // Shift Right Arithmetic
      [["110", "X"], [true, (a, b) => a | b]], // Or
      [["111", "X"], [true, (a, b) => a & b]], // And
   ]);

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.aluCalc) {
         let [signed, op] = ALU.table.match(this.wires.aluOp as number, this.wires.aluAlt);

         let in1 = Bits.toInt(this.wires.aluIn1, signed);
         let in2 = Bits.toInt(this.wires.aluIn2, signed);

         this.output = Bits(op(in1, in2), 33, signed).slice(0, 32);
      }
   }

   falling_edge() {
      this.wires.aluOut = this.output;
      this.wires.aluZero = this.output.every(b => b == 0);
   }

   reset_outputs() {
      this.output = Bits(0n, 32);
      this.wires.aluOut = Bits(0n, 32);
      this.wires.aluZero = 0;
   }
}

export class RegisterFile implements Component {
   public registers: Bits[];
   public out1: Bits = Bits(0n, 32);
   public out2: Bits = Bits(0n, 32);
   private wires: Wires;

   constructor(wires: Wires) {
      this.registers = Array(32).fill(Bits(0n, 32));
      this.wires = wires;
   }

   rising_edge() {
      let reg1 = Bits.toNumber(this.wires.readReg1, false);
      let reg2 = Bits.toNumber(this.wires.readReg2, false);
      this.out1 = this.registers[reg1];
      this.out2 = this.registers[reg2];

      if (this.wires.regWrite) {
         let writeReg = Bits.toNumber(this.wires.writeReg, false);
         if (writeReg != 0)
            this.registers[writeReg] = [...this.wires.writeData];
      }
   }

   falling_edge() {
      this.wires.readData1 = this.out1;
      this.wires.readData2 = this.out2;
   }

   reset_outputs() {
      this.out1 = Bits(0n, 32);
      this.out2 = Bits(0n, 32);
      this.wires.readData1 = Bits(0n, 32);
      this.wires.readData2 = Bits(0n, 32);
   }
}

export class WriteDataMux implements Component {
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.writeDataMuxSrc == WriteDataSrc.ALUOut) {
         this.wires.writeData = this.wires.aluOut;
      } else if (this.wires.writeDataMuxSrc == WriteDataSrc.MemRead) {
         this.wires.writeData = this.wires.memReadData;
      } else if (this.wires.writeDataMuxSrc == WriteDataSrc.PC4) {
         this.wires.writeData = this.wires.pcVal4;
      } else if (this.wires.writeDataMuxSrc == WriteDataSrc.Imm) {
         this.wires.writeData = this.wires.immediate;
      }
   }

   falling_edge() { }

   reset_outputs() {
      this.wires.writeData = Bits(0n, 32);
   }
}

export class ALUSrcMux1 implements Component {
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.aluSrc1 == ALUSrc1.Reg1) {
         this.wires.aluIn1 = this.wires.readData1;
      } else if (this.wires.aluSrc1 == ALUSrc1.PC) {
         this.wires.aluIn1 = this.wires.pcVal;
      }
   }

   falling_edge() { }

   reset_outputs() {
      this.wires.aluIn1 = Bits(0n, 32);
   }
}

export class ALUSrcMux2 implements Component {
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.aluSrc2 == ALUSrc2.Reg2) {
         this.wires.aluIn2 = this.wires.readData2;
      } else if (this.wires.aluSrc2 == ALUSrc2.Imm) {
         this.wires.aluIn2 = this.wires.immediate;
      }
   }

   falling_edge() { }

   reset_outputs() {
      this.wires.aluIn2 = Bits(0n, 32);
   }
}

export class PCSrcMux implements Component {
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.pcSrc == PCSrc.PC4) {
         this.wires.pcIn = this.wires.pcVal4;
      } else if (this.wires.pcSrc == PCSrc.JumpControl) {
         this.wires.pcIn = this.wires.jumpAddr;
      }
   }

   falling_edge() { }

   reset_outputs() {
      this.wires.pcIn = Bits(0n, 32);
   }
}

export class MemAddrMux implements Component {
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.memAddrMuxSrc == MemAddrSrc.ALUOut) {
         this.wires.memAddress = this.wires.aluOut;
      } else if (this.wires.memAddrMuxSrc == MemAddrSrc.PC) {
         this.wires.memAddress = this.wires.pcVal;
      }
   }

   falling_edge() { }

   reset_outputs() {
      this.wires.memAddress = Bits(0n, 32);
   }
}