// Default args for terminal startup.
// `-i -l` makes zsh/fallback shell behave like macOS Terminal's login interactive shell.
export const DEFAULT_STARTUP_ARGS = ["-i", "-l"]

// Toggle terminal input diagnostics in browser console.
export const TERMINAL_INPUT_DEBUG = false

// Shifted output for number row keys when using EN keyboard mapping.
export const SHIFTED_DIGIT_BY_CODE: Record<string, string> = {
  Digit1: "!",
  Digit2: "@",
  Digit3: "#",
  Digit4: "$",
  Digit5: "%",
  Digit6: "^",
  Digit7: "&",
  Digit8: "*",
  Digit9: "(",
  Digit0: ")",
}

// Shifted output for symbol keys when using EN keyboard mapping.
export const SHIFTED_SYMBOL_BY_CODE: Record<string, string> = {
  Minus: "_",
  Equal: "+",
  BracketLeft: "{",
  BracketRight: "}",
  Backslash: "|",
  Semicolon: ":",
  Quote: '"',
  Comma: "<",
  Period: ">",
  Slash: "?",
  Backquote: "~",
}

// Unshifted output for symbol keys when using EN keyboard mapping.
export const PLAIN_SYMBOL_BY_CODE: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
}
