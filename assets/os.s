# the code begins at address 0x0000_0000
# all ecall starts in this code
j ZZOS_main
.word              0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF,      0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF
.word 0xB8, 0xD4, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF,      0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF
.word 0x104, 0x124, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF,      0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF
.word 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF,      0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF, 0xFFFF_FFFF

# 10 = print char = B8
# 11 = print string = D4
# 20 = get char = 104
# 21 = get line = 124

ZZOS_main:
    slli t0, a0, 2
	lw t0, 0(t0)
    addi t1, zero, -1
    beq t0, t1, ZZOS_FAULT
	jalr zero, 0(t0)
ZZOS_FAULT:
	halt

# assume a1 is character to print
ZZOS_print_char:
	# Print char
	lui t0, 0x00021
ZZOS_pc_cw:
	lw t1, 20(t0)
	bne t1, zero, ZZOS_pc_cw
	sb a1, 24(t0)
	addi t0, zero, 0x10
	sw t0, 20(t0)
	ret

# a1: addr of null terminated string
ZZOS_print_string:
	MV a2, a1
	addi t0, zero, %lo(ZZOS_print_string_end)
	SW ra, 0xC(t0)
	# Get char, end if it's null
	lb a1, 0(a2)
	beq a1, zero, ZZOS_print_string_end
	jal ra, ZZOS_print_char
	# Increment and loop
	addi a2, a2, 1
	j ZZOS_print_string
ZZOS_print_string_end:
	addi t0, zero, %lo(ZZOS_print_string_end)
	LW ra, 0xC(t0)
	ret
.word 0x0

ZZOS_get_char:
	lui t0, 0x00021
ZZOS_gc_wc:
	lw t1, 0(t0)
	andi t1, t1, 1
	beq t1, zero, ZZOS_gc_wc
	lb a0, 4(t0)
	# manage if multiple chars are in the buffer
	lw t1, 0(t0)
	sw zero, 0(t0)
	ret

# a1: addr of the buffer to put the string in
# Blocks until it receives a newline (0xA)
ZZOS_get_line:
	# Wait for status reg to say there's chars available
	lui t0, 0x00021
	addi t0, t0, 4
	lw t1, -4(t0)
	andi t1, t1, 0x10
	beq t1, zero, ZZOS_get_line
	# Read chars (t0 = read addr, t1 = final addr, t2 = char)
	lw t1, -4(t0)
	andi t1, t1, 0xF
	addi t1, t1, 1
	add t1, t1, t0
ZZOS_get_line_loop:
	lb t2, 0(t0)
	sb t2, 0(a1)
	addi t0, t0, 1
	addi a1, a1, 1
	bne t0, t1, ZZOS_get_line_loop
	# Write back to status reg
	lui t0, 0x00021
	sw zero, 0(t0)
	# Check if we found \n
	addi t0, zero, 0xA
	bne t0, t2, ZZOS_get_line
	# Leave
	sb zero, 0(a1)
	ret
