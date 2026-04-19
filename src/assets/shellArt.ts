// ASCII art frames for the ShellOS conch shell logo

export const SHELL_FRAME_1 = `
       ___
      /   \\
     |     |
      \\   /
       \\_/
`;

export const SHELL_FRAME_2 = `
       ____
      / __ \\
     | /  \\ |
     | \\__/ |
      \\ __ /
       \\__/
`;

export const SHELL_FRAME_3 = `
        ___
       /   \\
      / ~~~ \\
     | /^^^\\ |
     | \\   / |
      \\ \\_/ /
       \\   /
        \\_/
    ~ ShellOS ~
`;

export const SHELL_LOGO_FULL = `
      .---.
     /     \\
    | () () |
    |  ___  |
    | /   \\ |
     \\ ~~~ /
      '---'
  🐚 ShellOS v1.0
  Conch Computing Inc.
`;

export const SHELL_SAD = `
      .---.
     /     \\
    | X   X |
    |  ___  |
    | /   \\ |
     \\ ~~~ /
      '---'
   SAD SHELL :(
`;

export const SHELL_NEOFETCH = `       .---.
      /     \\       ShellOS v1.0
     | () () |      Kernel: ConchKernel 1.0
     |  ___  |      CPU: 6502 @ 1MHz
     | /   \\ |      Memory: 640K
      \\ ~~~ /       Shell: ShellTerm 1.0
       '---'        Display: CRT 80x25
    🐚 ShellOS      Uptime: since boot`;

export function cowsay(text: string): string {
  const maxLen = Math.min(text.length, 40);
  const top = ' ' + '_'.repeat(maxLen + 2);
  const bot = ' ' + '-'.repeat(maxLen + 2);
  const lines: string[] = [];

  // Word wrap
  for (let i = 0; i < text.length; i += maxLen) {
    lines.push(text.slice(i, i + maxLen));
  }

  const body = lines.length === 1
    ? `< ${lines[0].padEnd(maxLen)} >`
    : lines.map((l, i) => {
        const c = i === 0 ? '/ ' : i === lines.length - 1 ? '\\ ' : '| ';
        const e = i === 0 ? ' \\' : i === lines.length - 1 ? ' /' : ' |';
        return c + l.padEnd(maxLen) + e;
      }).join('\n');

  return `${top}
${body}
${bot}
      \\
       \\
        .---.
       /     \\
      | () () |
       \\_____/`;
}
