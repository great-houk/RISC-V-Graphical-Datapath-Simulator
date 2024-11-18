
@{%
const moo = require("moo") // Have to use require instead of import here to get webpack to work

const lexer = moo.compile({
    WS:      {match: /[ \t]+/, value: x => undefined},
    newline: {match: '\n', lineBreaks: true},
    comment: {match: /#.*?$/, value: x => undefined},
    number:  /0[bB][01]+|0[xX][0-9a-fA-F]+|[+-]?[0-9]+/,
    identifier: /[a-zA-Z_][a-zA-Z_0-9]*/,
    directive: /\.[a-zA-Z_0-9]+/,
    symbol: [",", "(", ")", ":"],
    anything: /[^\n]+/,
    error: moo.error, // return an error token instead of throwing, so we can get line number info.
});

// Modify the next method to remove any token with an undefined value.
const mooNext = lexer.next;
lexer.next = () => {
    let tok;
    while ((tok = mooNext.call(lexer)) && tok.value === undefined) {}
    return tok;
};

%}
@lexer lexer

program -> line {% id %} | line %newline program {% ([l, _, p]) => [...l, ...p] %}
# split labels out as a separate "line"
line -> (%identifier ":"):? instr:? directive:? %comment:? {% ([l, i, d, c]) => [l ? {type: "label", label: l[0].text} : null, i, d].filter(s => s) %}

instr -> (arglessInstr | basicInstr | displacementInstr)
         # We kept op as a token, now we get line number and convert to a string
         {% ([[instr]]) => ({...instr, op: instr.op.text, line: instr.op.line}) %} 

arglessInstr -> op {% ([op]) => ({type: "argless", op: op, args: []}) %}

basicInstr -> op (arg ","):* arg
    {% ([op, args, last]) => ({type: "basic", op: op, args: [...args.map(([a, _]) => a), last]}) %}

displacementInstr -> op arg "," arg "(" arg ")"
    {% ([op, regA, , disp, , regB, ]) => ({type: "displacement", op: op, args: [regA, disp, regB]}) %}

op -> %identifier {% ([op]) => op %} # keep op as a token so we can get line number from it.
arg -> (identifier | number) {% ([[arg]]) => arg %}

identifier -> %identifier {% ([id]) => ({type: "id", value: id.text}) %}
number -> %number {% ([n]) => ({type: "num", value: BigInt(n.text)}) %}
anything -> %anything {% ([a]) => ({type: "any", value: a.text}) %}

directive -> %directive directiveArg:* {% ([d, ...args]) => ({type: "directive", directive: d.text, line: d.line, args: args[0]}) %}
directiveArg -> (indentifier | number | anything) {% ([[arg]]) => arg %}