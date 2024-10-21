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
   Jump
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
   public memRead: Bit = 0;
   public memWrite: Bit = 0;
   public memSize: MemSize = 0; // 2 bits (byte/half-word/word)
   public memSigned: Bit = 0; // 1 bit (whether to sign extend the output from memory)
   /* Set By MemAddrMux */
   public memAddress: Bits = []; // 32 bits
   // writeData = reg2
   public memReadData: Bits = []; // 32 bits

   // PC
   /* Set By PC */
   public pcVal: Bits = Bits(0n, 32); // 32 bits
   /* Set By PCMux */
   public pcIn: Bits = []; // 32 bits
   /* Set By Control */
   public branchZero: Bit = 0;
   public branchNotZero: Bit = 0;
   public jump: Bit = 0;

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
      Instruction Mem:
         loadInstr
      RAM:
         memRead
         memWrite
         memSize
         memSigned
      PC:
         branchZero
         branchNotZero
         jump
      ALU:
         aluOp
      Register File:
         regWrite
      Muxes:
         writeDataMuxSrc
         aluSrc
         pcSrc
         memAddrMuxSrc
   */

   constructor(wires: Wires) {
      this.wires = wires;
   }

   /**
    * Control FSM can break the rules, because it needs to be special in order to work. Because of this, it must be run first.
    */
   rising_edge() {
      this.reset_outputs();

      if (this.state == State.FETCH) {
         // Memory is always reading
         this.wires.memAddrMuxSrc = MemAddrSrc.PC;
      } else if (this.state == State.DECODE) {
         this.wires.loadInstr = 1;
      } else if (this.state == State.EXECUTE) {
         if (this.wires.type == InstructionType.Register || this.wires.type == InstructionType.Immediate) {
            // Set up ALU
            this.wires.aluAlt = this.wires.funct7[5];
            this.wires.aluOp = Bits.toNumber(this.wires.funct3);
            this.wires.aluSrc1 = ALUSrc1.Reg1;
            this.wires.aluSrc2 = (this.wires.type == InstructionType.Register) ? ALUSrc2.Reg2 : ALUSrc2.Imm;
         } else if (this.wires.type == InstructionType.Upper) {

         }
      } else if (this.state == State.MEMORY) {
      } else if (this.state == State.WRITEBACK) {
      }
   }

   /**
    * Updates state based on the current state.
    * FETCH -> DECODE -> EXECUTE -> MEMORY -> WRITEBACK
    * Or:
    * RESET -> FETCH -> ...
    */
   falling_edge() {
      if (this.state == State.RESET)
         this.state = State.FETCH;
      else
         this.state = this.state + 1 % 5;
   }

   reset_outputs() {
      this.wires.loadInstr = 0;
      this.wires.memRead = 0;
      this.wires.memWrite = 0;
      this.wires.memSize = 0;
      this.wires.memSigned = 0;
      this.wires.branchZero = 0;
      this.wires.branchNotZero = 0;
      this.wires.jump = 0;
      this.wires.aluOp = 0;
      this.wires.regWrite = 0;
      this.wires.writeDataMuxSrc = 0;
      this.wires.aluSrc2 = 0;
      this.wires.pcSrc = 0;
      this.wires.memAddrMuxSrc = 0;
   }
}

export class RAM implements Component {
   public data: Memory;
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

   rising_edge() { }

   falling_edge() { }

   reset_outputs(): void { }
}

export class PC implements Component {
   public val: bigint = 0n;
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() { }

   falling_edge() { }

   reset_outputs() { }
}

export class ALU implements Component {
   public output: Bits = []; // 32 Bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() { }

   falling_edge() { }

   reset_outputs() { }
}

export class RegisterFile implements Component {
   public data: bigint[];
   public out1: Bits = []; // 32 bits
   public out2: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.data = Array(32).fill(0n)
      this.wires = wires;
   }

   rising_edge() { }

   falling_edge() { }

   reset_outputs() { }
}

export class WriteDataMux implements Component {
   public output: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() { }

   falling_edge() { }

   reset_outputs() { }
}

export class ALUSrcMux1 implements Component {
   public output: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() { }

   falling_edge() { }

   reset_outputs() { }
}

export class ALUSrcMux2 implements Component {
   public output: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() { }

   falling_edge() { }

   reset_outputs() { }
}

export class PCMux implements Component {
   public output: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() { }

   falling_edge() { }

   reset_outputs() { }
}

export class MemAddrMux implements Component {
   public output: Bits = []; // 32 bits
   private wires: Wires;

   constructor(wires: Wires) {
      this.wires = wires;
   }

   rising_edge() { }

   falling_edge() { }

   reset_outputs() { }
}