import { Bit, Bits, b } from "utils/bits"
import * as Comp from "./components"

export class Simulator {
   public code: bigint[] = []; // The code loaded in the simulator

   public static readonly textStart = 0x0000_0000n // typically this would be 0x0001_0000 but lets use zero for simplicity.

   // components
   public wires: Comp.Wires;

   public controlFSM: Comp.ControlFSM;

   public writeDataMux: Comp.WriteDataMux;
   public aluSrcMux1: Comp.ALUSrcMux1;
   public aluSrcMux2: Comp.ALUSrcMux2;
   public pcMux: Comp.PCMux;
   public memAddrMux: Comp.MemAddrMux;

   public instructionMemory: Comp.InstructionMemory;
   public ram: Comp.RAM;
   public pc: Comp.PC;
   public jumpControl: Comp.JumpControl;
   public alu: Comp.ALU;
   public registerFile: Comp.RegisterFile;

   private componentList: Comp.Component[] = [];

   constructor(code: bigint[] = [], regs: Record<number, bigint> = {}) {
      this.wires = new Comp.Wires();

      this.controlFSM = new Comp.ControlFSM(this.wires);
      this.componentList.push(this.controlFSM);

      this.writeDataMux = new Comp.WriteDataMux(this.wires);
      this.aluSrcMux1 = new Comp.ALUSrcMux1(this.wires);
      this.aluSrcMux2 = new Comp.ALUSrcMux2(this.wires);
      this.pcMux = new Comp.PCMux(this.wires);
      this.memAddrMux = new Comp.MemAddrMux(this.wires);
      this.componentList.push(this.writeDataMux, this.aluSrcMux1, this.aluSrcMux2, this.pcMux, this.memAddrMux);

      this.instructionMemory = new Comp.InstructionMemory(this.wires);
      this.ram = new Comp.RAM(this.wires);
      this.pc = new Comp.PC(this.wires);
      this.jumpControl = new Comp.JumpControl(this.wires);
      this.alu = new Comp.ALU(this.wires);
      this.registerFile = new Comp.RegisterFile(this.wires);
      this.componentList.push(this.instructionMemory, this.ram, this.pc, this.jumpControl, this.alu, this.registerFile);

      this.pc.val = Bits(Simulator.textStart, 32);
      this.setRegisters({ 2: 0xBFFFFFF0n, 3: 0x10008000n }); // sp and gp

      this.setCode(code); // initialize code memory
      this.setRegisters(regs); // set custom registers
   }

   /** Initialize instruction memory */
   setCode(code: bigint[]) {
      this.code = [...code];
      this.ram.data.storeArray(Simulator.textStart, 4, code);
   }

   /**
    * Sets the registers. Takes a map of register number to register value.
    * Register values should be positive.
    */
   setRegisters(regs: Record<number, bigint>) {
      for (let reg in regs) {
         if (regs[reg] < 0)
            throw Error("setRegisters() expects unsigned integers.");
         if (reg == "0" && regs[reg] != 0n)
            throw Error("Can't set zero register.");
         this.registerFile.registers[reg] = Bits(regs[reg], 32);
      }
   }

   /**
    * Steps the simulation one clock tick. Returns false is the simulation has reached the
    * end of the program, true otherwise. The "end of the program" is the first 0x00000000
    * instruction. (0x00000000 is not a valid RISC-V instruction.)
    */
   tick() {
      // Rising edge
      this.componentList.forEach(component => {
         component.rising_edge();
      });
      // Falling edge
      this.componentList.forEach(component => {
         component.falling_edge();
      });

      return true
   }

   /** Runs the simulator until the end of the code. */
   run() {
      while (this.tick()) { }
   }
}
