import type { FSNode } from '../types';

const rawFiles = import.meta.glob('/src/filesystem/**/*', {
  query: '?raw',
  eager: true,
}) as Record<string, { default: string }>;

function buildFileTree(): FSNode {
  const root: FSNode = { name: '/', type: 'directory', children: [] };

  for (const [path, mod] of Object.entries(rawFiles)) {
    const relativePath = path.replace('/src/filesystem/', '');
    const parts = relativePath.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (isFile) {
        current.children!.push({
          name: part,
          type: 'file',
          content: mod.default,
        });
      } else {
        let dir = current.children!.find(
          (c) => c.name === part && c.type === 'directory'
        );
        if (!dir) {
          dir = { name: part, type: 'directory', children: [] };
          current.children!.push(dir);
        }
        current = dir;
      }
    }
  }

  // Sort: directories first, then alphabetical
  const sortChildren = (node: FSNode) => {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortChildren);
    }
  };
  sortChildren(root);

  return root;
}

export const fileSystem = buildFileTree();

export function getNodeAtPath(path: string): FSNode | null {
  const clean = path.replace(/^\/+|\/+$/g, '');
  if (!clean) return fileSystem;

  const parts = clean.split('/');
  let current = fileSystem;

  for (const part of parts) {
    if (part === '..') {
      return null; // simplified: no parent traversal
    }
    if (part === '.') continue;
    const child = current.children?.find((c) => c.name === part);
    if (!child) return null;
    current = child;
  }

  return current;
}

export function listDirectory(path: string): FSNode[] {
  const node = getNodeAtPath(path);
  if (!node || node.type !== 'directory') return [];
  return node.children || [];
}

export function readFile(path: string): string | null {
  const node = getNodeAtPath(path);
  if (!node || node.type !== 'file') return null;
  return node.content ?? null;
}
