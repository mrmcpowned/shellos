import { useState, useCallback } from 'react';
import { fileSystem, getNodeAtPath } from '../services/filesystem';
import type { FSNode } from '../types';

interface FileExplorerProps {
  onOpenFile: (path: string, content: string) => void;
}

export default function FileExplorer({ onOpenFile }: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const currentNode = getNodeAtPath(currentPath === '/' ? '' : currentPath.replace(/^\//, ''));
  const entries = currentNode?.children || fileSystem.children || [];

  const navigate = useCallback((name: string, type: string) => {
    if (type === 'directory') {
      setCurrentPath((prev) => {
        const base = prev === '/' ? '' : prev;
        return `${base}/${name}`;
      });
    }
  }, []);

  const handleDoubleClick = useCallback(
    (entry: FSNode) => {
      if (entry.type === 'directory') {
        navigate(entry.name, 'directory');
      } else if (entry.content !== undefined) {
        const filePath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
        onOpenFile(filePath, entry.content);
      }
    },
    [currentPath, navigate, onOpenFile]
  );

  const goUp = useCallback(() => {
    setCurrentPath((prev) => {
      const parts = prev.split('/').filter(Boolean);
      parts.pop();
      return '/' + parts.join('/');
    });
  }, []);

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  return (
    <div className="file-explorer">
      <div className="file-breadcrumb">
        <span
          className="file-breadcrumb-segment"
          onClick={() => setCurrentPath('/')}
        >
          🐚 /
        </span>
        {breadcrumbs.map((seg, i) => (
          <span key={i}>
            {' / '}
            <span
              className="file-breadcrumb-segment"
              onClick={() => setCurrentPath('/' + breadcrumbs.slice(0, i + 1).join('/'))}
            >
              {seg}
            </span>
          </span>
        ))}
      </div>

      {currentPath !== '/' && (
        <div className="file-list-item" onDoubleClick={goUp} onTouchEnd={goUp}>
          <span className="file-list-icon">⬆️</span>
          <span className="file-list-name">..</span>
        </div>
      )}

      {entries.map((entry) => (
        <div
          key={entry.name}
          className="file-list-item"
          onDoubleClick={() => handleDoubleClick(entry)}
          onTouchEnd={() => handleDoubleClick(entry)}
        >
          <span className="file-list-icon">
            {entry.type === 'directory' ? '📁' : '📄'}
          </span>
          <span className="file-list-name">{entry.name}</span>
        </div>
      ))}

      {entries.length === 0 && (
        <div style={{ padding: '12px', color: '#808080', fontStyle: 'italic' }}>
          (empty folder)
        </div>
      )}
    </div>
  );
}
