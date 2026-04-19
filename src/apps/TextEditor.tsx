import { useRef, useCallback } from 'react';

interface TextEditorProps {
  filePath?: string;
  initialContent?: string;
}

export default function TextEditor({ filePath, initialContent }: TextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  const handleInput = useCallback(() => {
    // Content lives in the DOM via contentEditable — no state sync needed
  }, []);

  return (
    <div className="text-editor">
      <div
        ref={editorRef}
        className="text-editor-content"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        spellCheck={false}
        aria-label={filePath ? `Editing ${filePath}` : 'Text Editor'}
        dangerouslySetInnerHTML={{ __html: (initialContent || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') }}
      />
    </div>
  );
}
