import { listDirectory, readFile, getNodeAtPath } from '../services/filesystem';
import { SHELL_NEOFETCH, cowsay } from '../assets/shellArt';

interface CommandContext {
  cwd: string;
  setCwd: (path: string) => void;
  setColor: (color: 'green' | 'amber' | 'white') => void;
  openFile: (path: string, content: string) => void;
  triggerShutdown: () => void;
  triggerCrash: () => void;
}

interface CommandResult {
  output: string;
  clear?: boolean;
  matrix?: boolean;
}

function resolvePath(cwd: string, path: string): string {
  if (path.startsWith('/')) return path;
  const parts = cwd.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  for (const seg of path.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return '/' + parts.join('/');
}

const HELP_TEXT = `Available commands:
  help          Show this help message
  about         About ShellOS
  date          Show current date and time
  dir [path]    List directory contents
  ls [path]     List directory contents
  cd <path>     Change directory
  cat <file>    Display file contents
  type <file>   Display file contents
  edit <file>   Open file in Text Editor
  pwd           Print working directory
  echo <text>   Print text
  clear         Clear terminal
  color <c>     Set color (green, amber, white)
  shutdown      Shut down ShellOS
  crash         Trigger system error
  neofetch      System info
  cowsay <text> Make the shell say something
  matrix        Enter the Matrix`;

export function executeCommand(input: string, ctx: CommandContext): CommandResult {
  const trimmed = input.trim();
  if (!trimmed) return { output: '' };

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  switch (cmd) {
    case 'help':
      return { output: HELP_TEXT };

    case 'about':
      return {
        output: `ShellOS v1.0\nConch Computing Inc.\n"The shell that never closes."\n640K RAM — 20MB HDD`,
      };

    case 'date':
      return { output: new Date().toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })};

    case 'dir':
    case 'ls': {
      const targetPath = args ? resolvePath(ctx.cwd, args) : ctx.cwd;
      const entries = listDirectory(targetPath.replace(/^\//, '') || '/');
      if (!entries.length) {
        const node = getNodeAtPath(targetPath.replace(/^\//, '') || '/');
        if (!node) return { output: `Directory not found: ${targetPath}` };
        return { output: '(empty directory)' };
      }
      const lines = entries.map((e) => {
        const icon = e.type === 'directory' ? '📁' : '📄';
        const suffix = e.type === 'directory' ? '/' : '';
        return `  ${icon} ${e.name}${suffix}`;
      });
      return { output: `Directory of ${targetPath}\n\n${lines.join('\n')}\n\n  ${entries.length} item(s)` };
    }

    case 'cd': {
      if (!args) return { output: ctx.cwd };
      const newPath = resolvePath(ctx.cwd, args);
      const clean = newPath.replace(/^\//, '') || '/';
      const node = getNodeAtPath(clean === '/' ? '' : clean);
      if (!node || node.type !== 'directory') {
        return { output: `Directory not found: ${newPath}` };
      }
      ctx.setCwd(newPath === '' ? '/' : newPath);
      return { output: '' };
    }

    case 'cat':
    case 'type': {
      if (!args) return { output: `Usage: ${cmd} <filename>` };
      const filePath = resolvePath(ctx.cwd, args);
      const content = readFile(filePath.replace(/^\//, ''));
      if (content === null) return { output: `File not found: ${filePath}` };
      return { output: content };
    }

    case 'edit': {
      if (!args) return { output: 'Usage: edit <filename>' };
      const filePath = resolvePath(ctx.cwd, args);
      const content = readFile(filePath.replace(/^\//, ''));
      if (content === null) return { output: `File not found: ${filePath}` };
      ctx.openFile(filePath, content);
      return { output: `Opening ${filePath} in Text Editor...` };
    }

    case 'pwd':
      return { output: ctx.cwd };

    case 'echo':
      return { output: args };

    case 'clear':
      return { output: '', clear: true };

    case 'color': {
      const c = args.toLowerCase();
      if (['green', 'amber', 'white'].includes(c)) {
        ctx.setColor(c as 'green' | 'amber' | 'white');
        return { output: `Terminal color set to ${c}` };
      }
      return { output: 'Usage: color <green|amber|white>' };
    }

    case 'shutdown':
      ctx.triggerShutdown();
      return { output: 'Shutting down...' };

    case 'crash':
      ctx.triggerCrash();
      return { output: '' };

    case 'neofetch':
      return { output: SHELL_NEOFETCH };

    case 'cowsay':
      return { output: cowsay(args || 'moo') };

    case 'matrix':
      return { output: 'Entering the Matrix...', matrix: true };

    default:
      return { output: `Bad command or file name: ${cmd}` };
  }
}
