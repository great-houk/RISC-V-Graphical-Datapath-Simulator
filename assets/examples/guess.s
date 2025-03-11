# Number guessing game

main:
	# Load random number
	lui a0, 0x00022
	lw a0, 0(a0)
	andi a0, a0, 0x7F
	# Start main loop
	jal main_loop
	# Quit
	j quit

quit:
	halt

# a0: the string to parse
# Returns: a0 = the parsed number, or -1 if invalid
parse_num:
	# t0 = current number
	# t1 = char
	# t2 = scratch/final answer
	addi t0, zero, 0
parse_num_loop:
	# Multiply t0 by 10 (but store previous val in t2)
	add t2, t0, zero
	slli t1, t0, 3
	slli t0, t0, 1
	add t0, t0, t1
	# Load char
	lb t1, 0(a0)
	addi a0, a0, 1
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
	addi t0, zero, -1
parse_num_end:
	add a0, t2, zero
	ret

# a0: addr of null terminated string
# a1: if 0, don't print newline, otherwise do
print_string:
	# Get char, end if it's null
	lb t0, 0(a0)
	beq t0, zero, print_string_end
	# Print char
	lui t1, 0x00021
	sb t0, 24(t1)
	addi t0, zero, 0x10
	sw t0, 20(t1)
	# Increment and loop
	addi a0, a0, 1
	j print_string
print_string_end:
	# Print newline if needed
	beq a1, zero, print_string_ret
	addi t0, zero, 0xA # Newline
	sb t0, 24(t1)
	addi t0, zero, 0x10
	sw t0, 20(t1)
print_string_ret:
	ret

# a0: addr of the buffer to put the string in
# Blocks until it receives a newline (0xA)
get_line:
	# Wait for status reg to say there's chars available
	lui t0, 0x00021
	addi t0, t0, 4
	lw t1, -4(t0)
	andi t1, t1, 0x10
	beq t1, zero, get_line
	# Read chars (t0 = read addr, t1 = final addr, t2 = char)
	lw t1, -4(t0)
	andi t1, t1, 0xF
	addi t1, t1, 1
	add t1, t1, t0
get_line_loop:
	lb t2, 0(t0)
	sb t2, 0(a0)
	addi t0, t0, 1
	addi a0, a0, 1
	bne t0, t1, get_line_loop
	# Write back to status reg
	lui t0, 0x00021
	sw zero, 0(t0)
	# Check if we found \n
	addi t0, zero, 0xA
	bne t0, t2, get_line
	# Leave
	sb zero, 0(a0)
	ret

main_loop:
	# Save registers
	addi sp, sp, -4
	sw ra, 0(sp)
	# Load some values
	add s0, a0, zero # s0 = target
	lui s1, %hi(string)
	addi s1, s1, %lo(string) # s1 = string buffer
	j loop
	# Print out invalid prompt
invalid:
	lui a0, %hi(error)
	addi a0, a0, %lo(error)
	addi a1, zero, 1
	jal print_string
	# Print out prompt
loop:
	lui a0, %hi(prompt)
	addi a0, a0, %lo(prompt)
	addi a1, zero, 0
	jal print_string
	# Get number
	add a0, s1, zero
	jal get_line
	# Parse
	add a0, s1, zero
	jal parse_num
	add s2, a0, zero
	# Print out the same number if valid, error if not
	addi t0, zero, 129
	bgeu a0, t0, invalid
	add a0, s1, zero
	jal print_string
	# Print out if guess was correct, or it needs to be higher or lower
	addi a1, zero, 1
	beq s0, s2, print_success
	blt s0, s2, print_lower
	# Higher
	lui a0, %hi(higher)
	addi a0, a0, %lo(higher)
	jal print_string
	j loop
	# Lower
print_lower:
	lui a0, %hi(lower)
	addi a0, a0, %lo(lower)
	jal print_string
	j loop
	# Success
print_success:
	lui a0, %hi(success)
	addi a0, a0, %lo(success)
	jal print_string
	# Return
	lw ra, 0(sp)
	addi sp, sp, 4
	ret

prompt: .string "Enter a number (0-128): "
error: .string "Number not valid! Please try again"
success: .string "Congrats! You guessed it :)"
higher: .string "Just a little bit higher"
lower: .string "A smidgen lower"
string: .string "Buffer string so there's space to store it"