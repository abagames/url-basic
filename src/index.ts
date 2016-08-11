import * as _ from 'lodash';
declare const require: any;
const Parser = require('js-expression-eval');

enum CommandType {
  print, locate, cls, delay, if, end, else, elif, for, while, let
}
interface Command {
  type: CommandType;
  args: string[];
  str: string;
}

const maxExecCommandCount = 100;
const maxScreenPos = 50;
let isKeyPressing = _.times(256, () => false);
let screen: string;
let commands: Command[];
let pc: number;
let cursorPos: number;
let isBackToScopeFirst: boolean;
let vars: any;
let delayCount: number;
let isRunning: boolean;
let requestAnimationFrameHandler: number;
let parsingCommand: string;
let parsingPc: number;

export function init(code: string = null) {
  isRunning = false;
  if (requestAnimationFrameHandler != null) {
    cancelAnimationFrame(requestAnimationFrameHandler);
  }
  screen = '';
  pc = 0;
  cursorPos = 0;
  isBackToScopeFirst = false;
  vars = { mod: (a, b) => a % b, true: (0 == 0), false: (0 == 1) };
  delayCount = 0;
  window.onkeydown = e => {
    isKeyPressing[e.keyCode] = true;
  };
  window.onkeyup = e => {
    isKeyPressing[e.keyCode] = false;
  };
  if (code == null) {
    code = decodeURI(window.location.hash);
    if (code == null || code.length <= 0) {
      return;
    }
    code = code.substr(1);
  }
  try {
    parseCode(code);
  } catch (e) {
    showScreen(`${parsingPc + 1}/${parsingCommand} ${e}`);
    console.error(e.stack);
    return;
  }
  isRunning = true;
  update();
};

function parseCode(code: string) {
  commands = _.map(code.split(':'), (c, i) => {
    parsingCommand = c;
    parsingPc = i;
    let typeStr = c;
    let args = [];
    let ai = c.indexOf(' ');
    if (ai < 0) {
      ai = c.indexOf('"');
    }
    if (ai > 0) {
      typeStr = c.substr(0, ai);
      args = _.map(c.substr(ai).split(';'), a => a.trim());
    }
    typeStr = typeStr.trim();
    let type: CommandType;
    const ck = <any>_.findKey(CommandType, (cStr: string) => _.startsWith(cStr, typeStr));
    if (ck != null) {
      type = Number(ck);
    }
    if (type == null && indexOfAssign(c) >= 0) {
      type = CommandType.let;
      args = [c.trim()];
    }
    if (type == null) {
      throw 'unknown command';
    }
    return { type, args, str: c.trim() };
  });
}

function update() {
  if (!isRunning) {
    return;
  }
  requestAnimationFrameHandler = requestAnimationFrame(update);
  delayCount--;
  if (delayCount > 0) {
    return;
  }
  for (let i = 0; i < maxExecCommandCount; i++) {
    if (pc >= commands.length) {
      isRunning = false;
      break;
    }
    if (pc >= commands.length || delayCount > 0) {
      break;
    }
    const execPc = pc;
    try {
      execCommand(commands[pc]);
      pc++;
    } catch (e) {
      showScreen(`${execPc + 1}/${commands[execPc].str} ${e}`);
      isRunning = false;
      console.error(e.stack);
      return;
    }
  }
  showScreen();
}

function execCommand(cmd: Command) {
  switch (cmd.type) {
    case CommandType.print:
      if (cursorPos > maxScreenPos) {
        break;
      }
      let s = cmd.args[0];
      if (_.startsWith(s, '"')) {
        s = s.replace(/^"|"$/g, "");
      } else {
        s = String(execExpression(s));
      }
      if (cursorPos < 0) {
        s = s.substr(-cursorPos);
        if (s.length <= 0) {
          break;
        }
        cursorPos = 0;
      }
      if (screen.length < cursorPos) {
        screen += new Array(cursorPos - screen.length + 1).join(' ');
      }
      screen = screen.substr(0, cursorPos) + s + screen.substr(cursorPos + s.length);
      cursorPos += s.length;
      screen = screen.replace(/ /g, '_');
      break;
    case CommandType.locate:
      cursorPos = execExpression(cmd.args[0]);
      break;
    case CommandType.cls:
      screen = '';
      cursorPos = 0;
      break;
    case CommandType.delay:
      delayCount = cmd.args.length > 0 ? execExpression(cmd.args[0]) : 1;
      break;
    case CommandType.for:
      if (!isBackToScopeFirst) {
        execExpression(cmd.args[0]);
      }
      const v = parseExpression(cmd.args[0]).assignVar;
      const to = execExpression(cmd.args[1]);
      const step = cmd.args.length < 3 ? 1 : execExpression(cmd.args[2]);
      if ((step >= 0 && vars[v] >= to) || (step < 0 && vars[v] <= to)) {
        breakScope();
        break;
      }
      if (isBackToScopeFirst) {
        vars[v] += step;
      }
      break;
    case CommandType.if:
      if (isBackToScopeFirst) {
        breakScope();
      } else {
        const cond = execExpression(cmd.args[0]);
        if (!cond) {
          breakScope(true);
        }
      }
      break;
    case CommandType.while:
      if (cmd.args.length >= 1 && !execExpression(cmd.args[0])) {
        breakScope();
      }
      break;
    case CommandType.end:
      backToScopeFirst();
      break;
    case CommandType.else:
    case CommandType.elif:
      breakScope();
      break;
    case CommandType.let:
      execExpression(cmd.args[0]);
      break;
    default:
      throw 'unknown command'
  }
  isBackToScopeFirst = cmd.type === CommandType.end;
}

function breakScope(isBreakToElse = false) {
  let nest = 0;
  for (let i = 0; i < maxExecCommandCount; i++) {
    pc++;
    if (pc >= commands.length) {
      break;
    }
    const cmd = commands[pc];
    if (isScopeCommand(cmd)) {
      nest++;
    }
    if (cmd.type === CommandType.end) {
      nest--;
    }
    if (nest < 0) {
      break;
    }
    if (isBreakToElse && nest <= 0) {
      if (cmd.type === CommandType.else) {
        break;
      } else if (cmd.type === CommandType.elif) {
        const cond = execExpression(cmd.args[0]);
        if (cond) {
          break;
        }
      }
    }
  }
}

function backToScopeFirst() {
  let nest = 0;
  for (let i = 0; i < maxExecCommandCount; i++) {
    pc--;
    if (pc < 0) {
      throw 'invalid scope';
    }
    const cmd = commands[pc];
    if (cmd.type === CommandType.end) {
      nest++;
    } else if (isScopeCommand(cmd)) {
      nest--;
    }
    if (nest < 0) {
      pc--;
      break;
    }
  }
}

function isScopeCommand(cmd) {
  const t = cmd.type;
  return (t === CommandType.for || t === CommandType.if || t === CommandType.while);
}

function parseExpression(exp: string) {
  let expStr = exp;
  let ai = indexOfAssign(expStr);
  let assignVar;
  if (ai >= 0) {
    assignVar = expStr.substr(0, ai).trim();
    assignVar = parseArray(assignVar);
    expStr = expStr.substr(ai + 1);
  }
  expStr = expStr.trim();
  expStr = parseArray(expStr);
  expStr = parseFunction(expStr);
  return { assignVar, expStr };
}

function parseArray(exp: string, i = 0) {
  const bi = exp.indexOf('[', i);
  if (bi < 0) {
    return exp;
  }
  const ei = exp.indexOf(']', i);
  if (ei < 0) {
    throw 'invalid array';
  }
  const idxStr = exp.substring(bi + 1, ei);
  const idx = execExpression(idxStr);
  const prevStr = exp.substring(0, bi);
  let arrayStr = `${prevStr}__${String(idx)}`;
  return parseArray(arrayStr + exp.substring(ei + 1), arrayStr.length);
}

function parseFunction(exp: string) {
  const regExp = /(^|[^a-zA-Z0-9_])(k|ke|key|s|sc|scr|scre|scree|screen)\((.*)\)/;
  const fm = exp.match(regExp);
  if (fm == null) {
    return exp;
  }
  const name = fm[2];
  const arg = execExpression(fm[3]);
  let funcStr: string;
  if (name[0] === 'k') {
    funcStr = isKeyPressing[arg] ? '(0==0)' : '(0==1)';
  } else if (name[0] === 's') {
    funcStr = String((arg < screen.length ? screen[arg] : ' ').charCodeAt(0));
  }
  const parsed = exp.replace(regExp, (m, p1, p2, p3, o, s) => p1 + funcStr);
  return parseFunction(parsed);
}

function execExpression(exp: string) {
  const pe = parseExpression(exp);
  const value = Parser.parse(pe.expStr).evaluate(vars);
  if (pe.assignVar != null) {
    vars[pe.assignVar] = value;
  }
  return value;
}

function indexOfAssign(s: string, i = 0) {
  let ei = s.indexOf('=', i);
  if (ei <= 0 || ei >= s.length - 1) {
    return -1;
  }
  const pc = s[ei - 1];
  const ac = s[ei + 1];
  if (ac === '=') {
    return indexOfAssign(s, ei + 2);
  }
  if (pc === '!' || pc === '>' || pc === '<') {
    return indexOfAssign(s, ei + 1);
  }
  return ei;
}

let lastScreen: string = null;
function showScreen(s: string = null) {
  if (s != null) {
    screen = s;
  }
  if (lastScreen === screen) {
    return;
  }
  lastScreen = screen;
  document.title = screen.length > 0 ? screen : '_';
}
