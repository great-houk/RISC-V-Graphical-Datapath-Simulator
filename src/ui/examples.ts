import { Radix } from "utils/radix"

/**
 * Stores a snapshot of code, register, and memory settings
 */
export interface Example {
	name: string,
	description: string,
	url?: string,
	code?: string,
	dataMemRadix?: Radix,
	dataMemWordSize?: number,
	regFileRadix?: Radix,
}

export const examples: Example[] = [
	{
		name: "Blank",
		description: "Clear the code, registers, and memory",
	}, {
		name: "Bubble Sort",
		description: "The bubble sort algorithm",
		url: require("assets/examples/bubbleSort.s"),
		dataMemRadix: "hex", regFileRadix: "hex",
	}, {
		name: "Selection Sort",
		description: "The selection sort algorithm",
		url: require("assets/examples/selectionSort.s"),
		dataMemRadix: "hex", regFileRadix: "hex",
	}, {
		name: "Guessing Game",
		description: "A simple number guessing game",
		url: require("assets/examples/guess.s"),
		dataMemRadix: "hex", regFileRadix: "hex",
	}
]
