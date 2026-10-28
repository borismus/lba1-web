// Life and track scripts of scene objects: disassembler and assembler.
//
// Opcodes and operand sizes come from the interpreters: GERELIFE.C (DoLife,
// DoFuncLife, DoTest) and GERETRAK.C (DoTrack); names from COMMON.H.
//
// Life scripts: an instruction is an opcode byte and its operands. The IF
// family (IF, SWIF, SNIF, ONEIF, NEVERIF, OR_IF) is followed by a condition:
// a function byte (LF_*) with its operand, a test byte (LT_*) and a value,
// a byte or a word depending on the function (DoFuncLife's TypeAnswer), then
// a word: the offset to jump to, from the start of the life script. OFFSET
// and ELSE jump unconditionally. SWIF/SNIF and ONEIF/NEVERIF rewrite their
// own opcode while running, so a script is read before it runs.
//
// Track scripts: opcode byte and operands, offsets counted from the start of
// the track script.
import { type Bytes, u16, s16, s8, Buf, latin1, fromLatin1 } from './bytes.ts';

// ── life ─────────────────────────────────────────────────────────────────
export const LM = ('END NOP SNIF OFFSET NEVERIF - - - - - LABEL RETURN IF SWIF ONEIF ELSE ' +
  'ENDIF BODY BODY_OBJ ANIM ANIM_OBJ SET_LIFE SET_LIFE_OBJ SET_TRACK ' +
  'SET_TRACK_OBJ MESSAGE FALLABLE SET_DIR SET_DIR_OBJ CAM_FOLLOW ' +
  'COMPORTEMENT_HERO SET_FLAG_CUBE COMPORTEMENT SET_COMPORTEMENT ' +
  'SET_COMPORTEMENT_OBJ END_COMPORTEMENT SET_FLAG_GAME KILL_OBJ SUICIDE ' +
  'USE_ONE_LITTLE_KEY GIVE_GOLD_PIECES END_LIFE STOP_L_TRACK ' +
  'RESTORE_L_TRACK MESSAGE_OBJ INC_CHAPTER FOUND_OBJECT SET_DOOR_LEFT ' +
  'SET_DOOR_RIGHT SET_DOOR_UP SET_DOOR_DOWN GIVE_BONUS CHANGE_CUBE OBJ_COL ' +
  'BRICK_COL OR_IF INVISIBLE ZOOM POS_POINT SET_MAGIC_LEVEL ' +
  'SUB_MAGIC_POINT SET_LIFE_POINT_OBJ SUB_LIFE_POINT_OBJ HIT_OBJ PLAY_FLA ' +
  'PLAY_MIDI INC_CLOVER_BOX SET_USED_INVENTORY ADD_CHOICE ASK_CHOICE ' +
  'BIG_MESSAGE INIT_PINGOUIN SET_HOLO_POS CLR_HOLO_POS ADD_FUEL SUB_FUEL ' +
  'SET_GRM SAY_MESSAGE SAY_MESSAGE_OBJ FULL_POINT BETA GRM_OFF ' +
  'FADE_PAL_RED FADE_ALARM_RED FADE_ALARM_PAL FADE_RED_PAL FADE_RED_ALARM ' +
  'FADE_PAL_ALARM EXPLODE_OBJ BULLE_ON BULLE_OFF ASK_CHOICE_OBJ ' +
  'SET_DARK_PAL SET_NORMAL_PAL MESSAGE_SENDELL ANIM_SET HOLOMAP_TRAJ ' +
  'GAME_OVER THE_END MIDI_OFF PLAY_CD_TRACK PROJ_ISO PROJ_3D TEXT ' +
  'CLEAR_TEXT BRUTAL_EXIT').split(' ');
export const LIFE_OP: Record<string, number> = Object.fromEntries(LM.map((n, i) => [n, i]));

// operands: b = byte, h = word, o = jump offset (word), s = zero-terminated
// string, x = a byte of runtime state. SET_DIR(_OBJ) take one more byte for FOLLOW.
export const LIFE_ARGS: Record<string, string> = {
  LABEL: 'b', COMPORTEMENT: 'b', FALLABLE: 'b', COMPORTEMENT_HERO: 'b',
  SET_MAGIC_LEVEL: 'b', SUB_MAGIC_POINT: 'b', CAM_FOLLOW: 'b',
  INIT_PINGOUIN: 'b', KILL_OBJ: 'b', SET_DIR: 'b', SET_DIR_OBJ: 'bb',
  SET_LIFE: 'o', SET_COMPORTEMENT: 'o', SET_LIFE_OBJ: 'bh',
  SET_COMPORTEMENT_OBJ: 'bh', SET_LIFE_POINT_OBJ: 'bb',
  SUB_LIFE_POINT_OBJ: 'bb', HIT_OBJ: 'bb', SET_TRACK: 'h',
  SET_TRACK_OBJ: 'bh', OFFSET: 'o', ELSE: 'o', BODY: 'b',
  BODY_OBJ: 'bb', ANIM: 'b', ANIM_OBJ: 'bb', ANIM_SET: 'b',
  MESSAGE_OBJ: 'bh', MESSAGE: 'h', SAY_MESSAGE_OBJ: 'bh',
  SAY_MESSAGE: 'h', SET_FLAG_CUBE: 'bb', SET_FLAG_GAME: 'bb',
  SET_USED_INVENTORY: 'b', GIVE_GOLD_PIECES: 'h', FOUND_OBJECT: 'b',
  SET_DOOR_LEFT: 'h', SET_DOOR_RIGHT: 'h', SET_DOOR_UP: 'h',
  SET_DOOR_DOWN: 'h', GIVE_BONUS: 'b', CHANGE_CUBE: 'b',
  PLAY_MIDI: 'b', ADD_FUEL: 'b', SUB_FUEL: 'b', SET_HOLO_POS: 'b',
  CLR_HOLO_POS: 'b', SET_GRM: 'b', OBJ_COL: 'b', INVISIBLE: 'b',
  BRICK_COL: 'b', ZOOM: 'b', POS_POINT: 'b', PLAY_FLA: 's',
  ADD_CHOICE: 'h', ASK_CHOICE: 'h', ASK_CHOICE_OBJ: 'bh',
  BIG_MESSAGE: 'h', BETA: 'h', EXPLODE_OBJ: 'b', HOLOMAP_TRAJ: 'b',
  PLAY_CD_TRACK: 'b', TEXT: 'h',
};
export const COND_OPS = new Set(['IF', 'SWIF', 'SNIF', 'ONEIF', 'NEVERIF', 'OR_IF']);
const MOVE_FOLLOW = 2;

export const LF = ('COL COL_OBJ DISTANCE ZONE ZONE_OBJ BODY BODY_OBJ ANIM ANIM_OBJ L_TRACK ' +
  'L_TRACK_OBJ FLAG_CUBE CONE_VIEW HIT_BY ACTION FLAG_GAME LIFE_POINT ' +
  'LIFE_POINT_OBJ NB_LITTLE_KEYS NB_GOLD_PIECES COMPORTEMENT_HERO CHAPTER ' +
  'DISTANCE_3D MAGIC_LEVEL MAGIC_POINT USE_INVENTORY CHOICE FUEL CARRY_BY ' +
  'CDROM').split(' ');
export const FUNC_OP: Record<string, number> = Object.fromEntries(LF.map((n, i) => [n, i]));
// functions with an object/flag operand byte, and those answering a word
export const FUNC_ARG = new Set(['COL_OBJ', 'DISTANCE', 'DISTANCE_3D', 'CONE_VIEW', 'LIFE_POINT_OBJ',
  'ZONE_OBJ', 'FLAG_CUBE', 'FLAG_GAME', 'USE_INVENTORY', 'L_TRACK_OBJ', 'BODY_OBJ', 'ANIM_OBJ']);
export const FUNC_WORD = new Set(['DISTANCE', 'DISTANCE_3D', 'CONE_VIEW', 'NB_GOLD_PIECES', 'CHOICE']);
export const LT = ['==', '>', '<', '>=', '<=', '!='];

// ── track ────────────────────────────────────────────────────────────────
export const TM = ('END NOP BODY ANIM GOTO_POINT WAIT_ANIM LOOP ANGLE POS_POINT LABEL GOTO ' +
  'STOP GOTO_SYM_POINT WAIT_NB_ANIM SAMPLE GOTO_POINT_3D SPEED BACKGROUND ' +
  'WAIT_NB_SECOND NO_BODY BETA OPEN_LEFT OPEN_RIGHT OPEN_UP OPEN_DOWN CLOSE ' +
  'WAIT_DOOR SAMPLE_RND SAMPLE_ALWAYS SAMPLE_STOP PLAY_FLA REPEAT_SAMPLE ' +
  'SIMPLE_SAMPLE FACE_TWINKEL ANGLE_RND').split(' ');
export const TRACK_OP: Record<string, number> = Object.fromEntries(TM.map((n, i) => [n, i]));
export const TRACK_ARGS: Record<string, string> = {
  BODY: 'b', ANIM: 'b', GOTO_POINT: 'b', ANGLE: 'h', POS_POINT: 'b',
  LABEL: 'b', GOTO: 'o', GOTO_SYM_POINT: 'b', WAIT_NB_ANIM: 'bb',
  SAMPLE: 'h', GOTO_POINT_3D: 'b', SPEED: 'h', BACKGROUND: 'b',
  WAIT_NB_SECOND: 'bxxxx', BETA: 'h', OPEN_LEFT: 'h', OPEN_RIGHT: 'h',
  OPEN_UP: 'h', OPEN_DOWN: 'h', SAMPLE_RND: 'h', SAMPLE_ALWAYS: 'h',
  SAMPLE_STOP: 'h', PLAY_FLA: 's', REPEAT_SAMPLE: 'h',
  SIMPLE_SAMPLE: 'h', FACE_TWINKEL: 'h', ANGLE_RND: 'hh',
};

export type Arg = number | string | null;
export interface Ins { at: number; name: string; args: Arg[] }
// for the IF family, args are [func, funcArg (null: none), test, value, jump]

function operands(code: Bytes, fmt: string, o: number): [Arg[], number] {
  const vals: Arg[] = [];
  for (const c of fmt) {
    if (c === 'b') vals.push(code[o++]);
    else if (c === 'x') o++;
    else if (c === 'h' || c === 'o') { vals.push(s16(code, o)); o += 2; }
    else if (c === 's') { const end = code.indexOf(0, o); vals.push(fromLatin1(code.subarray(o, end))); o = end + 1; }
  }
  return [vals, o];
}

export function life(code: Bytes): Ins[] {
  const out: Ins[] = [];
  let o = 0;
  while (o < code.length) {
    const at = o, op = code[o];
    const name = op < LM.length ? LM[op] : '?' + op;
    o++;
    let args: Arg[];
    if (COND_OPS.has(name)) {
      const f = LF[code[o++]];
      let farg: number | null = null;
      if (FUNC_ARG.has(f)) farg = code[o++];
      const test = LT[code[o++]];
      let value: number;
      if (FUNC_WORD.has(f)) { value = s16(code, o); o += 2; } else { value = s8(code, o); o += 1; }
      const jump = s16(code, o); o += 2;
      args = [f, farg, test, value, jump];
    } else {
      [args, o] = operands(code, LIFE_ARGS[name] || '', o);
      if ((name === 'SET_DIR' || name === 'SET_DIR_OBJ') && args[args.length - 1] === MOVE_FOLLOW) args.push(code[o++]);
    }
    out.push({ at, name, args });
    if (name.startsWith('?')) break;
  }
  return out;
}

// size in bytes of the life instruction at offset at
export function lifeSize(code: Bytes, at: number): number {
  const starts = life(code).map(i => i.at).concat([code.length]);
  return starts[starts.indexOf(at) + 1] - at;
}

export function track(code: Bytes): Ins[] {
  const out: Ins[] = [];
  let o = 0;
  while (o < code.length) {
    const at = o, op = code[o];
    const name = op < TM.length ? TM[op] : '?' + op;
    o++;
    let args: Arg[];
    [args, o] = operands(code, TRACK_ARGS[name] || '', o);
    out.push({ at, name, args });
    if (name.startsWith('?')) break;
  }
  return out;
}

// ── assembler ────────────────────────────────────────────────────────────
// POSIX-shell-like word splitting (Python's shlex.split(posix=True)): quotes
// group, backslash escapes outside single quotes
function shlex(line: string): string[] {
  const out: string[] = [];
  let cur = '', inWord = false, i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) throw new Error('No closing quotation: ' + line);
      cur += line.slice(i + 1, j); inWord = true; i = j + 1;
    } else if (c === '"') {
      i++; inWord = true;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length && '\\"$`\n'.includes(line[i + 1])) { cur += line[i + 1]; i += 2; }
        else cur += line[i++];
      }
      if (i >= line.length) throw new Error('No closing quotation: ' + line);
      i++;
    } else if (c === '\\' && i + 1 < line.length) { cur += line[i + 1]; inWord = true; i += 2; }
    else if (/\s/.test(c)) { if (inWord) { out.push(cur); cur = ''; inWord = false; } i++; }
    else { cur += c; inWord = true; i++; }
  }
  if (inWord) out.push(cur);
  return out;
}

const isInt = (s: string): boolean => /^-?\d+$/.test(s);

export type Say = (text: string) => number;
export type Resolve = (name: string) => number | undefined;  // @names that aren't labels

// Two passes over lines in the listing syntax: 'name:' defines a label;
// jump operands are '@name' or an offset; in life scripts, a condition is
// 'IF FUNC[(arg)] TEST VALUE else @label'; '"text"' as a MESSAGE-like
// operand becomes a text id through say(text). origin: where the code will
// sit in its script (labels are offsets from the script's start).
function assemble(text: string, ops: Record<string, number>, argsOf: Record<string, string>,
                  isLife: boolean, say: Say | null, origin: number): Bytes {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (line) lines.push(line);
  }
  const encode = (labels: Map<string, number>): [Bytes, Map<string, number>] => {
    const out = new Buf();
    const here = new Map<string, number>();
    const word = (v: number) => {
      if (v < -32768 || v > 32767) throw new Error(`word out of range: ${v}`);
      out.w16(v & 0xffff);
    };
    for (const line of lines) {
      if (line.endsWith(':') && !line.includes(' ')) { here.set(line.slice(0, -1), origin + out.length); continue; }
      const t = line.includes('"') ? shlex(line) : line.split(/\s+/);
      const name = t[0];
      if (!(name in ops)) throw new Error(`unknown instruction ${name} in ${JSON.stringify(line)}`);
      out.push(ops[name]);
      if (isLife && COND_OPS.has(name)) {
        const p = t[1].indexOf('(');
        const f = p < 0 ? t[1] : t[1].slice(0, p);
        const farg = p < 0 ? '' : t[1].slice(p + 1).replace(/\)+$/, '');
        if (!(f in FUNC_OP)) throw new Error(`unknown function ${f} in ${JSON.stringify(line)}`);
        out.push(FUNC_OP[f]);
        if (FUNC_ARG.has(f)) out.push(parseInt(farg, 10));
        out.push(LT.indexOf(t[2]));
        const v = parseInt(t[3], 10);
        if (FUNC_WORD.has(f)) word(v);
        else { if (v < -128 || v > 127) throw new Error(`byte out of range: ${v} in ${line}`); out.push(v & 0xff); }
        if (t[4] !== 'else') throw new Error(`expected else in ${JSON.stringify(line)}`);
        word(isInt(t[5]) ? parseInt(t[5], 10) : (labels.get(t[5].slice(1)) ?? 0));
        continue;
      }
      let fmt = argsOf[name] || '';
      const vals = t.slice(1);
      if (isLife && (name === 'SET_DIR' || name === 'SET_DIR_OBJ') && vals.length > fmt.length) fmt += 'b';
      if (vals.length !== fmt.replace(/x/g, '').length) throw new Error(`${name} takes ${fmt.length} operands: ${JSON.stringify(line)}`);
      let k = 0;
      for (const c of fmt) {
        if (c === 'x') { out.push(0); continue; }
        const v = vals[k++];
        if (c === 's') out.add(latin1(v)).push(0);
        else if (v.startsWith('@')) word(labels.get(v.slice(1)) ?? 0);
        else if (say && !isInt(v)) word(say(v));
        else if (c === 'b') out.push(parseInt(v, 10) & 0xff);
        else word(parseInt(v, 10));
      }
    }
    return [out.bytes(), here];
  };
  const [, labels] = encode(new Map());  // pass 1: label offsets (sizes don't depend on them)
  return encode(labels)[0];
}

// say(text) -> text id for '"quoted"' MESSAGE operands (called once per
// distinct text, in the order they first appear, though the source is
// encoded twice)
export function assembleLife(text: string, say: Say | null = null, origin = 0): Bytes {
  let sayer: Say | null = null;
  if (say) {
    const said = new Map<string, number>();
    sayer = s => { if (!said.has(s)) said.set(s, say(s)); return said.get(s)!; };
  }
  return assemble(text, LIFE_OP, LIFE_ARGS, true, sayer, origin);
}

export const assembleTrack = (text: string): Bytes => assemble(text, TRACK_OP, TRACK_ARGS, false, null, 0);

// ── listings (the syntax the assembler reads) ────────────────────────────
// A disassembled script as source: jump targets become labels L<offset>.
export function lifeSource(code: Bytes): string {
  const ins = life(code);
  const targets = new Set<number>();
  for (const i of ins) {
    if (COND_OPS.has(i.name)) targets.add(i.args[4] as number);
    else if (i.name === 'OFFSET' || i.name === 'ELSE' || i.name === 'SET_LIFE' || i.name === 'SET_COMPORTEMENT') targets.add(i.args[0] as number);
  }
  const starts = new Set(ins.map(i => i.at));
  const ref = (v: number) => starts.has(v) ? '@L' + v : String(v);
  const lines: string[] = [];
  for (const i of ins) {
    if (targets.has(i.at)) lines.push(`L${i.at}:`);
    if (COND_OPS.has(i.name)) {
      const [f, farg, test, value, jump] = i.args as [string, number | null, string, number, number];
      lines.push(`  ${i.name} ${f}${farg !== null ? `(${farg})` : ''} ${test} ${value} else ${ref(jump)}`);
    } else if (i.name === 'OFFSET' || i.name === 'ELSE' || i.name === 'SET_LIFE' || i.name === 'SET_COMPORTEMENT') {
      lines.push(`  ${i.name} ${ref(i.args[0] as number)}`);
    } else {
      lines.push(`  ${i.name}${i.args.map(a => ' ' + (typeof a === 'string' ? a : String(a))).join('')}`);
    }
  }
  return lines.join('\n');
}

export function trackSource(code: Bytes): string {
  const ins = track(code);
  const targets = new Set(ins.filter(i => i.name === 'GOTO').map(i => i.args[0] as number));
  const starts = new Set(ins.map(i => i.at));
  return ins.map(i => (targets.has(i.at) ? `L${i.at}:\n` : '') + (i.name === 'GOTO' && starts.has(i.args[0] as number)
    ? `  GOTO @L${i.args[0]}` : `  ${i.name}${i.args.map(a => ' ' + a).join('')}`)).join('\n');
}

// ── scene objects ────────────────────────────────────────────────────────
// (in scene.ts: they need the scene header layout)
export { u16 };
