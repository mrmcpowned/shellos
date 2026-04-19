// ASCII art frames for the ShellOS conch shell logo
// Based on algorithmically downscaled conch shell art

// Frame 1: Just the outer outline dots
export const SHELL_FRAME_1 = `
                  .    .
                 .      .
                .        .
               .          .
      .    . .              .
   .              .          .
 .       .        .         .
.     .      .     .        .
.    . .    .     .        .
.    . .   .    .         .
.      .       .         .
 .        .  .          .
  .                   .
   .                .
     .          .`;

// Frame 2: Outline with some internal structure
export const SHELL_FRAME_2 = `
                  .#@#+:
                 .%     #=
                +@       %-
               *@         @+
      :--++--:*            @+
   =#@       @@#  @       @@
 -%@    ##    @@=       @@#
=@   %**   #+*  @+%       @@
@    -# = @#. @+#       @%
@    =*@*# +# @%#       @=
%@    @**%   @@#%%      @@+
-@      @@%* @%*       @=
 :%@         @@        #:
   =%@             @@+:
     .-+*@@@@@@@@@#*=:`;

// Frame 3: Full detail
export const SHELL_FRAME_3 = `
                  .#@#+:
                 .%@@@@@#=
                +@@@@@@@@@%-
               *@@@@@@@@@@@@+
      :--++--:*@@@@@@@@@@@@@@+
   =#@@@@@@@@@@#%%@@@@@@@@@@@@
 -%@@@@@@##@@@@@@=%@@@@@@@@@@#
=@@@@@%**%@@#+*@@@+%@@@@@@@@@@
@@@@@@-#@=@@@#.@@@+#@@@@@@@@@%
@@@@@@=*@*#@%+#@@%#@@@@@@@@@@=
%@@@@@@**%@@@@@#%%@@@@@@@@@@+
-@@@@@@@@%*#@%*@@@@@@@@@@@@=
 :%@@@@@@@@@@@@@@@@@@@@@@#:
   =%@@@@@@@@@@@@@@@@@@+:
     .-+*@@@@@@@@@#*=:`;

// Full logo with title
export const SHELL_LOGO_FULL = `
                  .#@#+:
                 .%@@@@@#=
                +@@@@@@@@@%-
               *@@@@@@@@@@@@+
      :--++--:*@@@@@@@@@@@@@@+
   =#@@@@@@@@@@#%%@@@@@@@@@@@@
 -%@@@@@@##@@@@@@=%@@@@@@@@@@#
=@@@@@%**%@@#+*@@@+%@@@@@@@@@@
@@@@@@-#@=@@@#.@@@+#@@@@@@@@@%
@@@@@@=*@*#@%+#@@%#@@@@@@@@@@=
%@@@@@@**%@@@@@#%%@@@@@@@@@@+
-@@@@@@@@%*#@%*@@@@@@@@@@@@=
 :%@@@@@@@@@@@@@@@@@@@@@@#:
   =%@@@@@@@@@@@@@@@@@@+:
     .-+*@@@@@@@@@#*=:

  🐚 ShellOS v1.0
  Conch Computing Inc.`;

// Sad shell for system errors
export const SHELL_SAD = `
                  .#@#+:
                 .%@@@@@#=
                +@@@ X @@%-
               *@@@@@@@@@@@@+
      :--++--:*@@@@@@@@@@@@@@+
   =#@@@@@@@@@@#%%@@@@@@@@@@@@
 -%@@@@@@##@@@@@@=%@@@@@@@@@@#
=@@@@@%**%@@#+*@@@+%@@@@@@@@@@
@@@@@@=*@*#@%+#@@%#@@@@@@@@@@=
%@@@@@@**%@@@@@#%%@@@@@@@@@@+
 :%@@@@@@@@@@@@@@@@@@@@@@#:
     .-+*@@@@@@@@@#*=:

   SAD SHELL :(`;

// Neofetch-style system info (25x12 shell with info on right)
export const SHELL_NEOFETCH = `               -@@*=
              =@@@@@%+:       ShellOS v1.0
            .#@@@@@@@@@+      Kernel: ConchKernel 1.0
     .:-+-::%@@@@@@@@@@@+     CPU: 6502 @ 1MHz
  -*@@@@@@@@%%%@@@@@@@@@@     Memory: 640K
:#@@@@%%%@%%@@#%@@@@@@@@@     Shell: ShellTerm 1.0
%@@@@*%#%@@=#@@*@@@@@@@@@     Display: CRT 80x25
@@@@@+@#*@%+@@@#@@@@@@@@*     Uptime: since boot
%@@@@@*%#%@%%%%@@@@@@@@*
-%@@@@@@%%@%@@@@@@@@@@+.
 .+%@@@@@@@@@@@@@@@%+.
    -+#%@@@@@@@%*+-
    \u{1F41A} ShellOS`;

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
       \\   .#@#+:
          .%@@@@@#=
         +@@@@@@@@@%-
        *@@@@@@@@@@@@+
       :--++--:*@@@@@@+
    =#@@@@@@@@@@#%%@@@@
  -%@@@@@@##@@@@@@=@@#
     .-+*@@@@@@@@@#*=:`;
}
