import { emitKeypressEvents, type Key } from 'node:readline';
import { RELEASE_DATE, VERSION } from '@clqn/shared';
import { type Frame, wrap } from './chat-view.js';
import { copyCode, openLink } from './login-prompt.js';
import { GoBack } from './setup.js';
import { mouseReportReader, terminalSizeNotice } from './terminal.js';
import { clip, painter, plain, width } from './text.js';

// docs/assets/wordmark.svg, one character per pixel.
const wordmark = [
  '.........##......................',
  '.........##......................',
  '..####...##.......###.##..##.###.',
  '.######..##......#######..#######',
  '###..##..##.....###..###..###..##',
  '##.......##.....##....##..##...##',
  '##.......##.....##....##..##...##',
  '###..##..##.....###..###..##...##',
  '.######..#####...#######..##...##',
  '..####....####....######..##...##',
  '......................##.........',
  '......................##.........',
];
// The outlines and noses of docs/assets/logo.svg in braille, two by four pixels per cell. `p` cells are noses.
const logo = [
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣠⣤⣤⣤⣤⣀⡀⠀⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⠛⠃⠀⠀⠀⠀⠉⠷⡆⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇⠀⢀⠀⠀⠀⠀⡀⠀⣿⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇⠀⣿⠀⠀⠀⢸⡇⠀⣿⠀⠀⠀⠀⠀⠀',
  '⠀⠀⠀⠀⣤⡴⠶⠶⠶⠶⣤⣼⡇⠀⣠⣄⣀⣤⣤⡀⠀⣿⠀⠀⠀⠀⠀⠀',
  '⠀⠀⢀⡿⠉⠁⠀⠀⠀⠀⠀⠛⣇⠀⠻⠟⠛⠛⠻⠃⠀⣿⠀⠀⠀⠀⠀⠀',
  '⠀⠀⢸⡇⠀⣠⠀⠀⠀⢀⡄⠀⣿⠀⠀⢀⣰⣶⠛⠛⠛⠛⠳⢶⣀⠀⠀⠀',
  '⠀⠀⢸⡇⠀⠿⠀⠀⠀⠸⠇⠀⣿⣀⣀⣼⠃⠀⠀⠀⠀⠀⠀⠈⢹⡄⠀⠀',
  '⠀⠀⢸⡇⠀⣴⣦⣤⣶⣶⡄⠀⣿⠀⠀⣿⠀⢠⡆⠀⠀⠀⣴⠀⢸⡇⠀⠀',
  '⠀⠀⠾⡇⠀⠙⠋⠉⠉⠙⠁⠀⣿⠆⢀⣿⠀⠘⠃⠀⠀⠀⠛⠀⢸⣇⠀⠀',
  '⠀⠀⠀⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁⠀⠈⠹⠤⠴⠿⠶⠾⠿⠷⠤⠼⠿⠀⠀',
];
const noses = [
  '',
  '',
  '',
  '',
  '              ppppp',
  '              ppppp',
  '',
  '',
  '      ppppp',
  '      pppp',
  '                  ppppp',
];
const site = 'https://clqn.org';
const repository = 'https://github.com/clqn-org/clqn';
const npm = 'https://www.npmjs.com/package/clqn-cli';

// xterm 256-color palette entries, which render in every color terminal, unlike 24-bit color.
const peach = 216;
const gradient = [223, 223, 223, 223, 216, 216, 216, 216, 173, 173, 173, 173];
const shadow = 95;
const nose = 211;
const dim = 137;
const fg = (color: number) => `38;5;${color}`;

// The wordmark one row per pixel, as two full blocks in foreground colors, with a vertical gradient and a
// drop shadow. Half blocks and background colors would halve its height, but some terminals (Terminal.app)
// draw them with visible seams between rows.
export function wordmarkLines(color: boolean): string[] {
  const letter = (x: number, y: number) => wordmark[y]?.[x] === '#';
  const lines: string[] = [];
  for (let y = 0; y <= wordmark.length; y++) {
    let line = '';
    for (let x = 0; x <= wordmark[0]!.length; x++) {
      if (letter(x, y)) line += color ? `\x1b[${fg(gradient[y]!)}m██\x1b[0m` : '██';
      else if (color && letter(x - 1, y - 1)) line += `\x1b[${fg(shadow)}m██\x1b[0m`;
      else line += '  ';
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function logoLines(color: boolean): string[] {
  if (!color) return logo.map((row) => row.replaceAll('⠀', ' ').trimEnd());
  return logo.map((row, y) =>
    [...row]
      .map((cell, x) => (cell === '⠀' ? ' ' : `\x1b[${fg(noses[y]![x] === 'p' ? nose : peach)}m${cell}\x1b[0m`))
      .join(''),
  );
}

// OSC 8 links keep the short label clickable; terminals without them still show it.
const link = (label: string, url: string, links: boolean) =>
  links ? `\x1b]8;;${url}\x1b\\\x1b[4m${label}\x1b[24m\x1b]8;;\x1b\\` : label;

export interface LandingView {
  columns: number;
  rows: number;
  color: boolean;
  links: boolean;
  user?: string | undefined;
  directory: string;
  repository?: string | undefined;
  // What setup has printed so far, oldest first, and the question waiting for an answer.
  log: string[];
  // With choices, the prompt is a menu: ↑↓ move the selection and Enter picks it.
  prompt?:
    | {
        question: string;
        answer: string;
        back?: boolean | undefined;
        choices?: string[] | undefined;
        selected?: number | undefined;
      }
    | undefined;
  // The number of lines back from the latest output.
  scroll?: number;
  // Replaces the log and prompt, e.g. the session settings form, sized to the flow's columns and rows.
  content?: ((columns: number, rows: number) => string[]) | undefined;
}

// Wordmark on top, then a box with the logo and local context on the left and the setup flow on the right.
export type LandingFrame = Frame & {
  links: { row: number; column: number; size: number; url: string }[];
  history?: { offset: number; max: number; pageSize: number };
};
export function landingFrame(view: LandingView): LandingFrame {
  const { columns, rows, color } = view;
  const sizeNotice = terminalSizeNotice(columns, rows);
  if (sizeNotice) return { lines: [sizeNotice], links: [] };
  const paint = painter(color);
  const tone = (text: string, code: number) => (color && text ? `\x1b[${fg(code)}m${text}\x1b[0m` : text);
  const margin = columns >= 60 ? 2 : 0;
  const inner = columns - 2 * margin;
  const lines: string[] = [];
  const indent = ' '.repeat(margin);
  if (rows >= 34 && inner >= 68) {
    lines.push('', ...wordmarkLines(color).map((line) => indent + line), '');
  }

  // The box border carries the version and links, dropping the links that do not fit.
  const release = `clqn v${VERSION} (${RELEASE_DATE.replaceAll('-', '.')})`;
  const names = ['clqn.org', 'Documentation', 'GitHub', 'npm'];
  const titles = [
    ...names.map((_, index) => [release, ...names.slice(0, names.length - index)]),
    [release],
    [`clqn v${VERSION}`],
  ];
  const parts = titles.find((entry) => width(` ${entry.join(' · ')} `) <= inner - 6) ?? [];
  const titleWidth = parts.length ? width(` ${parts.join(' · ')} `) : 0;
  const urls: Record<string, string> = { 'clqn.org': site, Documentation: `${site}/docs/`, GitHub: repository, npm };
  const title = parts.length
    ? ` ${parts
        .map((part, index) => {
          const url = urls[part];
          const styled = tone(part, index ? dim : peach);
          return url ? link(styled, url, view.links) : styled;
        })
        .join(tone(' · ', dim))} `
    : '';
  const before = Math.floor((inner - 2 - titleWidth) / 2);
  const after = inner - 2 - titleWidth - before;
  lines.push(indent + tone(`┌${'─'.repeat(before)}`, dim) + title + tone(`${'─'.repeat(after)}┐`, dim));

  const height = Math.max(1, rows - lines.length - 1);
  const body = inner - 4;
  // The flow sits well clear of the logo and the top border when there is room.
  const gap = 8;
  const sidebar = body >= 34 + gap + 30 ? 34 : 0;
  const pane = sidebar ? body - sidebar - gap : body;
  const detailWidth = Math.min(34, sidebar || pane);
  const details = [
    view.user ? tone(clip(plain(view.user), detailWidth), peach) : paint('Not signed in', 'muted'),
    paint(clip(plain(view.directory), detailWidth), 'muted'),
    ...(view.repository
      ? [
          link(
            paint(clip(plain(view.repository), detailWidth), 'muted'),
            `https://github.com/${encodeURI(view.repository)}`,
            view.links,
          ),
        ]
      : []),
  ];
  const left: string[] = [];
  if (sidebar) {
    const showLogo = height >= logo.length + 2 + details.length;
    const block = [...(showLogo ? [...logoLines(color).map((line) => ' '.repeat(3) + line), ''] : []), ...details];
    left.push(
      // A third of the spare rows above, so the art sits a little above center.
      ...Array(Math.max(0, Math.floor((height - block.length) / 3))).fill(''),
      ...block.map((line, index) => (index >= block.length - details.length ? center(line, sidebar) : line)),
    );
  }
  // Setup output scrolls above the fixed prompt. Session settings bring their own top line.
  const flow = sidebar ? (view.content ? [''] : ['', '']) : [...details, ''];
  if (view.content) flow.push(...view.content(pane, height - flow.length));
  else flow.push(...view.log.flatMap((line) => wrap(line, pane)));
  const input: string[] = [];
  let promptRow = -1;
  let hintRow = -1;
  if (view.prompt) {
    const question = plain(view.prompt.question);
    // A blank line separates the prompt from the text above it.
    if (view.log.some((line) => line.trim())) input.push('');
    const choices = view.prompt.choices;
    const back = view.prompt.back === false ? '' : 'Esc Back  ·  ';
    let keys = `${back}Ctrl+C Quit`;
    if (choices) {
      input.push(...wrap(question.trimEnd(), pane).map((line) => tone(line, peach)));
      // Long menus show a window that keeps the selection in view.
      const selected = Math.max(0, Math.min(choices.length - 1, view.prompt.selected ?? 0));
      const room = Math.max(1, height - input.length - 3);
      const start = Math.max(0, Math.min(selected - Math.floor(room / 2), choices.length - room));
      choices.slice(start, start + room).forEach((choice, index) => {
        const chosen = start + index === selected;
        const line = clip(`${chosen ? '›' : ' '} ${plain(choice)}`, pane);
        input.push(chosen ? tone(line, peach) : line);
      });
      keys = `↑↓ Move  ·  Enter Select  ·  ${keys}`;
    } else {
      const answer = plain(view.prompt.answer);
      if (width(question) + width(answer) < pane) input.push(tone(question, peach) + answer);
      else {
        const asked = wrap(question.trimEnd(), pane);
        input.push(...asked.map((line) => tone(line, peach)), tail(answer, pane - 1));
      }
      promptRow = input.length - 1;
    }
    hintRow = input.length;
    input.push('', ...wrap(keys, pane).map((line) => paint(line, 'muted')));
    if (flow.length + input.length > height && input.length < height) {
      input[hintRow] = paint(choices ? 'PgUp PgDn Scroll' : '↑↓ PgUp PgDn Scroll', 'muted');
    }
  }
  const pageSize = Math.max(0, height - input.length);
  const max = view.content || pageSize === 0 ? 0 : Math.max(0, flow.length - pageSize);
  const offset = Math.max(0, Math.min(max, view.scroll ?? 0));
  const end = flow.length - offset;
  const visibleLog = flow.slice(Math.max(0, end - pageSize), end);
  const shown = [...visibleLog, ...input].slice(-height);
  const top = lines.length;
  for (let row = 0; row < height; row++) {
    const right = shown[row] ?? '';
    const content = sidebar ? `${fit(left[row] ?? '', sidebar)}${' '.repeat(gap)}${right}` : right;
    lines.push(`${indent + tone('│', dim)} ${fit(content, body)} ${tone('│', dim)}`);
  }
  lines.push(indent + tone(`└${'─'.repeat(inner - 2)}┘`, dim));
  const row = shown.length - input.length + promptRow;
  const cursor: Frame['cursor'] =
    view.prompt && promptRow >= 0 && row >= 0
      ? {
          row: top + row,
          column: margin + 2 + (sidebar ? sidebar + gap : 0) + Math.min(width(stripped(input[promptRow]!)), pane - 1),
        }
      : undefined;
  const shownLines = lines.slice(0, rows);
  return {
    lines: shownLines,
    links: linkTargets(shownLines),
    history: { offset, max, pageSize },
    ...(cursor ? { cursor } : {}),
  };
}

// Where each link sits on screen, so a click can open it in terminals without OSC 8 support.
function linkTargets(lines: string[]) {
  const targets: { row: number; column: number; size: number; url: string }[] = [];
  lines.forEach((line, row) => {
    for (const match of line.matchAll(/\x1b\]8;;([^\x1b]+)\x1b\\(.*?)\x1b\]8;;\x1b\\/g)) {
      const column = width(stripped(line.slice(0, match.index)));
      targets.push({ row, column, size: width(stripped(match[2]!)), url: match[1]! });
    }
  });
  return targets;
}

// Opens the link under a 1-based mouse click, if any.
export function openLinkAt(links: LandingFrame['links'], column: number, row: number) {
  const target = links.find(
    (entry) => entry.row === row - 1 && column - 1 >= entry.column && column - 1 < entry.column + entry.size,
  );
  if (target) void openLink(target.url);
}

const stripped = (text: string) => text.replace(/\x1b\[[\d;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g, '');
// The end of a long answer, so the caret stays visible while typing.
function tail(text: string, limit: number) {
  let rest = text;
  while (width(rest) > limit) rest = rest.slice(1);
  return rest;
}
// Pads styled text to `size` columns.
const fit = (text: string, size: number) => text + ' '.repeat(Math.max(0, size - width(stripped(text))));
function center(line: string, size: number) {
  const space = Math.max(0, Math.floor((size - width(stripped(line))) / 2));
  return ' '.repeat(space) + line;
}

export interface Landing {
  ask(question: string, options?: { back?: boolean }): Promise<string>;
  // A menu picked with ↑↓ and Enter; resolves with the chosen index.
  choose(question: string, choices: string[], options?: { back?: boolean; selected?: number }): Promise<number>;
  print(text: string): void;
  update(details: { user?: string; repository?: string }): void;
  // Shows the GitHub device code in the flow until the returned function is called.
  showGithubLogin(verificationUri: string, userCode: string): () => void;
  close(): void;
}

// The full-screen page shown from launch until a clan is chosen. Ctrl+C or Ctrl+D quits.
export function openLanding(details: { user?: string; directory: string; repository?: string }): Landing {
  const { stdin, stdout } = process;
  const state = { ...details };
  const log: string[] = [];
  let prompt:
    | {
        question: string;
        answer: string;
        back?: boolean | undefined;
        choices?: string[] | undefined;
        selected?: number | undefined;
        resolve: (answer: string) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  // The next print after an answer starts a new step and replaces the previous one.
  let answered = false;
  let login: { uri: string; code: string; status: string } | undefined;
  let closed = false;
  let targets: LandingFrame['links'] = [];
  let scroll = 0;
  let pageSize = 0;
  const readMouse = mouseReportReader(scrollBy, (column, row) => openLinkAt(targets, column, row));

  function draw() {
    if (closed) return;
    const loginLines = login
      ? [
          'Open GitHub to authorize clqn:',
          login.uri,
          '',
          'Enter this one-time GitHub code:',
          login.code,
          '',
          'Enter Open GitHub  ·  C Copy code',
          ...(login.status ? [login.status] : []),
        ]
      : [];
    const rows = stdout.rows || 24;
    const frame = landingFrame({
      columns: stdout.columns || 80,
      rows,
      color: !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb',
      links: process.env.TERM !== 'dumb',
      ...state,
      log: [...log, ...loginLines],
      prompt,
      scroll,
    });
    targets = frame.links;
    scroll = frame.history?.offset ?? scroll;
    pageSize = frame.history?.pageSize ?? 0;
    const screen = frame.lines.map((line, index) => `\x1b[${index + 1};1H\x1b[2K${line}`).join('');
    const cursor = frame.cursor ? `\x1b[${frame.cursor.row + 1};${frame.cursor.column + 1}H\x1b[?25h` : '';
    // Clearing below a full-height frame would erase its last row, the bottom border.
    const rest = frame.lines.length < rows ? `\x1b[${frame.lines.length + 1};1H\x1b[J` : '';
    stdout.write(`\x1b[?25l${screen}${rest}${cursor}`);
  }

  function scrollBy(lines: number) {
    if (pageSize === 0) return;
    scroll = Math.max(0, scroll + lines);
    draw();
  }

  function close() {
    if (closed) return;
    closed = true;
    stdin.off('keypress', keypress);
    stdout.off('resize', draw);
    process.off('SIGINT', quit);
    process.off('SIGTERM', terminate);
    stdin.setRawMode(wasRaw);
    stdin.pause();
    stdout.write('\x1b[0m\x1b[?25h\x1b[?1006l\x1b[?1000l\x1b[?1049l');
  }

  function exit(code: number) {
    close();
    process.exit(code);
  }
  const quit = () => exit(130);
  const terminate = () => exit(143);

  function keypress(text: string | undefined, key: Key = {}) {
    if (readMouse(text, key.sequence)) return;
    if (key.ctrl && (key.name === 'c' || key.name === 'd')) return quit();
    if (terminalSizeNotice(stdout.columns || 80, stdout.rows || 24)) return;
    if ((key.name === 'up' || key.name === 'down') && prompt?.choices) {
      const count = prompt.choices.length;
      prompt.selected = ((prompt.selected ?? 0) + (key.name === 'up' ? count - 1 : 1)) % count;
      return draw();
    }
    if (key.name === 'up' || key.name === 'down') return scrollBy(key.name === 'up' ? 1 : -1);
    if (key.name === 'pageup' || key.name === 'pagedown') return scrollBy(key.name === 'pageup' ? pageSize : -pageSize);
    if (key.name === 'end') return scrollBy(-scroll);
    if (prompt) {
      if (key.name === 'return' || key.name === 'enter') {
        const { answer, resolve, choices, selected } = prompt;
        prompt = undefined;
        answered = true;
        resolve(choices ? String(selected ?? 0) : answer);
      } else if (key.name === 'escape' && prompt.back !== false) {
        const { reject } = prompt;
        prompt = undefined;
        answered = true;
        reject(new GoBack());
      } else if (prompt.choices) {
        // Menus take no typed text.
      } else if (key.name === 'backspace') prompt.answer = prompt.answer.slice(0, -1);
      else if (key.ctrl && key.name === 'u') prompt.answer = '';
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) prompt.answer += text;
    } else if (login) {
      const { uri, code } = login;
      const report = (message: string) => {
        if (!login) return;
        login.status = message;
        draw();
      };
      if (key.name === 'return' || key.name === 'enter')
        void openLink(uri).then((opened) => !opened && report('Could not open GitHub.'));
      else if (key.name === 'c')
        void copyCode(code).then((copied) => report(copied ? 'Code copied.' : 'Clipboard unavailable.'));
    }
    draw();
  }

  const wasRaw = stdin.isRaw;
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.on('keypress', keypress);
  stdout.on('resize', draw);
  process.once('SIGINT', quit);
  process.once('SIGTERM', terminate);
  // Mouse reports let a click open a link even where the terminal does not support OSC 8 links.
  stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[2J');
  stdin.resume();
  draw();

  return {
    ask: (question, options) =>
      new Promise((resolve, reject) => {
        scroll = 0;
        prompt = { question, answer: '', back: options?.back, resolve, reject };
        draw();
      }),
    choose: (question, choices, options) =>
      new Promise((resolve, reject) => {
        scroll = 0;
        prompt = {
          question,
          answer: '',
          back: options?.back,
          choices,
          selected: options?.selected ?? 0,
          resolve: (answer) => resolve(Number(answer)),
          reject,
        };
        draw();
      }),
    print(text) {
      if (answered) {
        log.length = 0;
        scroll = 0;
      }
      answered = false;
      log.push(...text.replace(/^\n+/, () => (log.length ? '\n' : '')).split('\n'));
      draw();
    },
    update(changes) {
      Object.assign(state, changes);
      draw();
    },
    showGithubLogin(uri, code) {
      scroll = 0;
      login = { uri, code, status: '' };
      draw();
      return () => {
        scroll = 0;
        login = undefined;
        draw();
      };
    },
    close,
  };
}
