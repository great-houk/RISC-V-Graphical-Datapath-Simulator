# Number guessing game

main:
	# Load random number
	lui a1, 0x00022
	lw a1, 0(a1)
	andi a1, a1, 0x7F
	# Start main loop
	jal main_loop
	# Quit
	j quit

quit:
	halt

# a1: the string to parse
# Returns: a1 = the parsed number, or -1 if invalid
parse_num:
	# t0 = current number
	# t1 = char
	# t2 = scratch/final answer
	addi t0, zero, 0
	# Check empty string
	lb t1, 0(a1)
	addi t2, t1, -10
	beq t2, zero, parse_num_error
parse_num_loop:
	# Multiply t0 by 10 (but store previous val in t2)
	add t2, t0, zero
	slli t1, t0, 3
	slli t0, t0, 1
	add t0, t0, t1
	# Load char
	lb t1, 0(a1)
	addi a1, a1, 1
	# Check if it's a newline, and end if so
	addi t1, t1, -10
	beq t1, zero, parse_num_end
	# Check if it's in the bounds of a num
	addi t1, t1, -38
	blt t1, zero, parse_num_error
	addi t2, zero, 10
	bge t1, t2, parse_num_error
	# Add to t0 and loop
	add t0, t0, t1
	j parse_num_loop
parse_num_error:
	addi t2, zero, -1
parse_num_end:
	add a1, t2, zero
	ret


main_loop:
	# Save registers
	addi sp, sp, -4
	sw ra, 0(sp)
	# Load some values
	add s0, a1, zero # s0 = target
	lui s1, %hi(string)
	addi s1, s1, %lo(string) # s1 = string buffer
	j loop
	# Print out invalid prompt
invalid:
	lui a1, %hi(error)
	addi a1, a1, %lo(error)
	addi a2, zero, 1
	# Print out prompt
    addi a0, zero, 11
    ecall
loop:
	lui a1, %hi(prompt)
	addi a1, a1, %lo(prompt)
	addi a2, zero, 0
    addi a0, zero, 11
    ecall
	# Get number
	add a1, s1, zero
	addi a0, zero, 21
    ecall
	# Parse
	add a1, s1, zero
	jal parse_num
	add s2, a1, zero
	# Print out the same number if valid, error if not
	addi t0, zero, 129
	bgeu a1, t0, invalid
	add a1, s1, zero
    addi a0, zero, 11
    ecall
	# Print out if guess was correct, or it needs to be higher or lower
	addi a2, zero, 1
	beq s0, s2, print_success
	blt s0, s2, print_lower
	# Higher
	lui a1, %hi(higher)
	addi a1, a1, %lo(higher)
    addi a0, zero, 11
    ecall
	j loop
	# Lower
print_lower:
	lui a1, %hi(lower)
	addi a1, a1, %lo(lower)
    addi a0, zero, 11
    ecall
	j loop
	# Success
print_success:
	lui a1, %hi(success)
	addi a1, a1, %lo(success)
    addi a0, zero, 11
    ecall
	# Return
	lw ra, 0(sp)
	addi sp, sp, 4
	ret

prompt: .string "Enter a number (0-128): "
error: .string "Number not valid! Please try again"
success: .string "Congrats! You guessed it :)"
higher: .string "Just a little bit higher"
lower: .string "A smidgen lower"
string: .string "Buffer string so there's space to store inputs"
