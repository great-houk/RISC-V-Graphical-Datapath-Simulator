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
   RESET
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
   PC,
}
enum ALUSrc1 {
   Reg1,
   PC,
   Zero,
}
enum ALUSrc2 {
   Reg2,
   Imm
}
enum PCSrc {
   PC4,
   ALUOut,
}
enum MemAddrSrc {
   ALUOut,
   PC
}
enum InstructionType {
   Register,
   Immediate,
   Upper,
   Load,
   Store,
   Branch,
   Jump,
}

interface Component {
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
   public type: InstructionType = 0; // 3 bits
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
   /* Set By PCMux */
   public pcIn: Bits = []; // 32 bits
   /* Set By Control */
   public loadPC: Bit = 0;

   // Jump Control
   /* Set By Control */
   public branchZero: Bit = 0;
   public branchNotZero: Bit = 0;
   /* Set By Jump Control */
   public shouldBranch: Bit = 0;

   // ALU
   /* Set By Control */
   public aluOp: ALUOp = 0; // 4 bits
   public aluAlt: Bit = 0;
   /* Set By ALUSrcMux1 File */
   public ALUIn1: Bits = []; // 32 bits
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

   // PCMux
   /* Set By Control */
   public pcSrc: PCSrc = 0; // 2 bits

   // MemAddrMux
   /* Set By Control */
   public memAddrMuxSrc: MemAddrSrc = 0; // 1 bit
}

export class ControlFSM implements Component {
   public state: State = State.RESET;
   private wires: Wires;

   /*
   Signals:
      Instr Mem:
         loadInstr
      Mem:
         memWrite
         memSize
         memUnsigned
         memAddrMuxSrc
      PC:
         loadPC
         pcSrc
      JumpControl:
         branchZero
         branchNotZero
      ALU:
         aluOp
         aluAlt
         aluSrc1
         aluSrc2
      Register File:
         regWrite
         writeDataMuxSrc
   */

   constructor(wires: Wires) {
      this.wires = wires;
   }

   /**
    * Control FSM can break the rules, because it needs to be special in order to work. Because of this, it must be run first.
    */
   rising_edge() {
      this.reset_outputs();

      // Make memory load the next instruction
      if (this.state == State.FETCH) {
         // Memory is always reading
         this.wires.memAddrMuxSrc = MemAddrSrc.PC;
      }
      // Decode the instruction and inc PC
      else if (this.state == State.DECODE) {
         // Mem output should be the next instruction, so load it
         this.wires.loadInstr = 1;
         // Inc PC
         this.wires.pcSrc = PCSrc.PC4;
         this.wires.loadPC = 1;
      }
      // Set up ALU
      else if (this.state == State.EXECUTE) {
         if (this.wires.type == InstructionType.Register || this.wires.type == InstructionType.Immediate) {
            this.wires.aluAlt = this.wires.funct7[5];
            this.wires.aluOp = Bits.toNumber(this.wires.funct3);
            this.wires.aluSrc1 = ALUSrc1.Reg1;
            this.wires.aluSrc2 = (this.wires.type == InstructionType.Register) ? ALUSrc2.Reg2 : ALUSrc2.Imm;
         } else if (this.wires.type == InstructionType.Upper) {
            this.wires.aluAlt = 0;
            this.wires.aluOp = ALUOp.Add;
            this.wires.aluSrc1 = this.wires.opcode[5] ? ALUSrc1.Zero : ALUSrc1.PC; // opcode[5] differentiates between LUI and AUIPC
            this.wires.aluSrc2 = ALUSrc2.Imm;
         } else if (this.wires.type == InstructionType.Load || this.wires.type == InstructionType.Store) {
            this.wires.aluAlt = 0;
            this.wires.aluOp = ALUOp.Add;
            this.wires.aluSrc1 = ALUSrc1.Reg1;
            this.wires.aluSrc2 = ALUSrc2.Imm;
         } else if (this.wires.type == InstructionType.Branch) {
            this.wires.aluAlt = 1;
            this.wires.aluOp = Bits.toNumber(this.wires.funct3.slice(1, 2));
            this.wires.aluSrc1 = ALUSrc1.Reg1;
            this.wires.aluSrc2 = ALUSrc2.Reg2;
         } else if (this.wires.type == InstructionType.Jump) {
            this.wires.aluAlt = 0;
            this.wires.aluOp = ALUOp.Add;
            this.wires.aluSrc1 = this.wires.opcode[3] ? ALUSrc1.PC : ALUSrc1.Reg1; // opcode[3] differentiates between JAL and JALR
            this.wires.aluSrc2 = ALUSrc2.Imm;
         }
      }
      // Read/Write from/to memory if necessary, set up branch controller, and set up ALU for branch addr
      else if (this.state == State.MEMORY) {
         if (this.wires.type == InstructionType.Store) {
            this.wires.memWrite = 1;
            this.wires.memAddrMuxSrc = MemAddrSrc.ALUOut;
            this.wires.memSize = Bits.toNumber(this.wires.funct3);
         } else if (this.wires.type == InstructionType.Load) {
            this.wires.memAddrMuxSrc = MemAddrSrc.ALUOut;
            this.wires.memSize = Bits.toNumber(this.wires.funct3);
            this.wires.memUnsigned = this.wires.funct3[2];
         }

         if (this.wires.type == InstructionType.Branch) {
            if (this.wires.funct3 == b`000` || this.wires.funct3 == b`001`) {
               this.wires.branchZero = !this.wires.funct3[0];
               this.wires.branchNotZero = this.wires.funct3[0];
            } else {
               this.wires.branchZero = this.wires.funct3[0];
               this.wires.branchNotZero = !this.wires.funct3[0];
            }
         }
         else if (this.wires.type == InstructionType.Jump) {
            this.wires.branchZero = 1;
            this.wires.branchNotZero = 1;
         }

         if (this.wires.type == InstructionType.Branch) {
            this.wires.aluAlt = 0;
            this.wires.aluOp = ALUOp.Add;
            this.wires.aluSrc1 = ALUSrc1.PC;
            this.wires.aluSrc2 = ALUSrc2.Imm;
         }
      }
      // Write back to register file, and update PC if necessary
      else if (this.state == State.WRITEBACK) {
         if (this.wires.type == InstructionType.Register || this.wires.type == InstructionType.Immediate || this.wires.type == InstructionType.Upper) {
            this.wires.regWrite = 1;
            this.wires.writeDataMuxSrc = WriteDataSrc.ALUOut;
         } else if (this.wires.type == InstructionType.Load) {
            this.wires.regWrite = 1;
            this.wires.writeDataMuxSrc = WriteDataSrc.MemRead;
         } else if (this.wires.type == InstructionType.Store || this.wires.type == InstructionType.Branch) {
            this.wires.regWrite = 0;
         } else if (this.wires.type == InstructionType.Jump) {
            this.wires.regWrite = 1;
            this.wires.writeDataMuxSrc = WriteDataSrc.PC;
         }

         if (this.wires.type == InstructionType.Branch || this.wires.type == InstructionType.Jump) {
            this.wires.pcSrc = PCSrc.ALUOut;
            this.wires.loadPC = this.wires.shouldBranch;
         }
      }
   }

   /**
    * Updates state based on the current state.
    * FETCH -> DECODE -> EXECUTE -> MEMORY -> WRITEBACK
    */
   falling_edge() {
      this.state = this.state + 1 % 5;
   }

   // Resets any outputs that can only be on for one clock cycle bc they would cause issues otherwise
   // Basically all the load signals
   reset_outputs() {
      this.wires.loadInstr = 0;
      this.wires.memWrite = 0;
      this.wires.loadPC = 0;
      this.wires.regWrite = 0;
   }
}

export class InstructionMemory implements Component {
   public instruction: Bits = Bits(0n, 32);
   private wires: Wires;

   private static type_table = new TruthTable<InstructionType>([
      [["0110011"], InstructionType.Register],
      [["0010011"], InstructionType.Immediate],
      [["0X10111"], InstructionType.Upper],
      [["0000011"], InstructionType.Load],
      [["0100011"], InstructionType.Store],
      [["1100011"], InstructionType.Branch],
      [["110X111"], InstructionType.Jump],
   ]);

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
      [["0X10111"], (i) => i.slice(12, 32)],
      // UJ-type -> imm[20|10:1|11|19:12] | rd | opcode
      [["1101111"], (i) => Bits.join(i[31], i.slice(12, 20), i[20], i.slice(21, 31), 0)],
   ])

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.loadInstr) {
         this.instruction = this.wires.memReadData;
      }
   }

   falling_edge() {
      this.wires.opcode = this.instruction.slice(0, 7);
      this.wires.writeReg = this.instruction.slice(7, 12);
      this.wires.funct3 = this.instruction.slice(12, 15);
      this.wires.readReg1 = this.instruction.slice(15, 20);
      this.wires.readReg2 = this.instruction.slice(20, 25);
      this.wires.funct7 = this.instruction.slice(25, 32);

      this.wires.type = InstructionMemory.type_table.match(this.instruction);
      let imm_gen = InstructionMemory.immediate_table.match(this.instruction);
      let imm = imm_gen(this.instruction);
      this.wires.immediate = Bits.extended(imm, 32, true);
   }

   reset_outputs() {
      this.wires.opcode = Bits(0n, 7);
      this.wires.writeReg = Bits(0n, 5);
      this.wires.funct3 = Bits(0n, 3);
      this.wires.readReg1 = Bits(0n, 5);
      this.wires.readReg2 = Bits(0n, 5);
      this.wires.funct7 = Bits(0n, 7);
      this.wires.type = InstructionType.Register;
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
      let data = Bits.toInt(this.wires.writeData, false);
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
   }

   reset_outputs() { }
}

export class JumpControl implements Component {
   // Controls PCMux
   public shouldBranch: Bit = 0;
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.branchZero || this.wires.branchNotZero) {
         this.shouldBranch = 0;
         this.shouldBranch = this.shouldBranch || (this.wires.branchZero && this.wires.aluZero);
         this.shouldBranch = this.shouldBranch || (this.wires.branchNotZero && !this.wires.aluZero);
      }
   }

   falling_edge() {
      this.wires.shouldBranch = this.shouldBranch;
   }

   reset_outputs() {
      this.wires.shouldBranch = 0;
   }
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
      let [signed, op] = ALU.table.match([this.wires.aluOp, this.wires.aluAlt]);

      let in1 = Bits.toInt(this.wires.ALUIn1, signed);
      let in2 = Bits.toInt(this.wires.aluIn2, signed);

      this.output = Bits(op(in1, in2), 33, signed).slice(0, 32);
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
   public data: Bits[];
   public out1: Bits = Bits(0n, 32);
   public out2: Bits = Bits(0n, 32);
   private wires: Wires;

   constructor(wires: Wires) {
      this.data = Array(32).fill(Bits(0n, 32));
      this.wires = wires;
   }

   rising_edge() {
      let reg1 = Bits.toNumber(this.wires.readReg1, false);
      let reg2 = Bits.toNumber(this.wires.readReg2, false);
      this.out1 = this.data[reg1];
      this.out2 = this.data[reg2];

      if (this.wires.regWrite) {
         let writeReg = Bits.toNumber(this.wires.writeReg, false);
         this.data[writeReg] = this.wires.writeData;
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
   public output: Bits = Bits(0n, 32); // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.writeDataMuxSrc == WriteDataSrc.ALUOut) {
         this.output = this.wires.aluOut;
      } else if (this.wires.writeDataMuxSrc == WriteDataSrc.MemRead) {
         this.output = this.wires.memReadData;
      } else if (this.wires.writeDataMuxSrc == WriteDataSrc.PC) {
         this.output = this.wires.pcVal;
      }
   }

   falling_edge() {
      this.wires.writeData = this.output;
   }

   reset_outputs() {
      this.output = Bits(0n, 32);
      this.wires.writeData = Bits(0n, 32);
   }
}

export class ALUSrcMux1 implements Component {
   public output: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.aluSrc1 == ALUSrc1.Reg1) {
         this.output = this.wires.readData1;
      } else if (this.wires.aluSrc1 == ALUSrc1.PC) {
         this.output = this.wires.pcVal;
      } else if (this.wires.aluSrc1 == ALUSrc1.Zero) {
         this.output = Bits(0n, 32);
      }
   }

   falling_edge() {
      this.wires.ALUIn1 = this.output;
   }

   reset_outputs() {
      this.output = Bits(0n, 32);
      this.wires.ALUIn1 = Bits(0n, 32);
   }
}

export class ALUSrcMux2 implements Component {
   public output: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.aluSrc2 == ALUSrc2.Reg2) {
         this.output = this.wires.readData2;
      } else if (this.wires.aluSrc2 == ALUSrc2.Imm) {
         this.output = this.wires.immediate;
      }
   }

   falling_edge() {
      this.wires.aluIn2 = this.output;
   }

   reset_outputs() {
      this.output = Bits(0n, 32);
      this.wires.aluIn2 = Bits(0n, 32);
   }
}

export class PCMux implements Component {
   public output: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.pcSrc == PCSrc.PC4) {
         let nextVal = Bits.toInt(this.wires.pcVal, false) + 4n;
         if (nextVal > 2n ** 32n) {
            throw new Error("PC overflow");
         }
         this.output = Bits(nextVal, 32);
      } else if (this.wires.pcSrc == PCSrc.ALUOut) {
         this.output = this.wires.aluOut;
      }
   }

   falling_edge() {
      this.wires.pcIn = this.output;
   }

   reset_outputs() {
      this.output = Bits(0n, 32);
      this.wires.pcIn = Bits(0n, 32);
   }
}

export class MemAddrMux implements Component {
   public output: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() {
      if (this.wires.memAddrMuxSrc == MemAddrSrc.ALUOut) {
         this.output = this.wires.aluOut;
      } else if (this.wires.memAddrMuxSrc == MemAddrSrc.PC) {
         this.output = this.wires.pcVal;
      }
   }

   falling_edge() {
      this.wires.memAddress = this.output;
   }

   reset_outputs() {
      this.output = Bits(0n, 32);
      this.wires.memAddress = Bits(0n, 32);
   }
}