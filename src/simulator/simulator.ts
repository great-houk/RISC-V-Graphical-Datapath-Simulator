import { Bit, Bits, b } from "utils/bits"
import * as Comp from "./components"

export class Simulator {
   public code: bigint[] = []; // The code loaded in the simulator

   public static readonly textStart = 0x0001_0000n // typically this would be 0x0001_0000 but lets use zero for simplicity.

   // components
   public wires: Comp.Wires;

   public controlFSM: Comp.ControlFSM;
   public jumpControl: Comp.JumpControl;

   public writeDataMux: Comp.WriteDataMux;
   public aluSrcMux1: Comp.ALUSrcMux1;
   public aluSrcMux2: Comp.ALUSrcMux2;
   public pcMux: Comp.PCSrcMux;
   public memAddrMux: Comp.MemAddrMux;

   public instructionMemory: Comp.InstructionMemory;
   public ram: Comp.RAM;
   public pc: Comp.PC;
   public alu: Comp.ALU;
   public registerFile: Comp.RegisterFile;

   private componentList: Comp.Component[] = [];

   constructor(code: bigint[] = [], regs: Record<number, bigint> = {}) {
      this.wires = new Comp.Wires();
      // Combinational control units have to be run first, so the control signals can propogate the same cycle
      this.controlFSM = new Comp.ControlFSM(this.wires);
      this.jumpControl = new Comp.JumpControl(this.wires);
      this.componentList.push(this.controlFSM, this.jumpControl);
      // Muxes + Instruction mem have to run next, as they control a lot of data
      this.writeDataMux = new Comp.WriteDataMux(this.wires);
      this.aluSrcMux1 = new Comp.ALUSrcMux1(this.wires);
      this.aluSrcMux2 = new Comp.ALUSrcMux2(this.wires);
      this.pcMux = new Comp.PCSrcMux(this.wires);
      this.memAddrMux = new Comp.MemAddrMux(this.wires);
      this.componentList.push(this.writeDataMux, this.aluSrcMux1, this.aluSrcMux2, this.pcMux, this.memAddrMux);
      // Could run before muxes, but this looks nicer
      this.instructionMemory = new Comp.InstructionMemory(this.wires);
      this.componentList.push(this.instructionMemory);
      // These can all run in whatever order
      this.ram = new Comp.RAM(this.wires);
      this.pc = new Comp.PC(this.wires);
      this.alu = new Comp.ALU(this.wires);
      this.registerFile = new Comp.RegisterFile(this.wires);
      this.componentList.push(this.ram, this.pc, this.alu, this.registerFile);
      // Set some values before the start, bc PC only gets set on the second cycle, so the instruction decoder can load from the wrong addr
      this.pc.val = Bits(Simulator.textStart, 32);
      this.wires.pcVal = this.pc.val;
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
      for (let component of this.componentList) {
         try {
            component.rising_edge();
         } catch (e) {
            if (e instanceof Comp.EndOfProgram)
               return false;
            else
               throw e;
         }
      }
      // Falling edge
      for (let component of this.componentList)
         component.falling_edge();

      return true
   }

   /** Runs the simulator until the end of the code. */
   run() {
      while (this.tick()) { }
   }
}
