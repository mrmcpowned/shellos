import { useState } from 'react';

interface TextEditorProps {
  filePath?: string;
  initialContent?: string;
}

export default function TextEditor({ filePath, initialContent }: TextEditorProps) {
  const [content, setContent] = useState(initialContent || '');

  return (
    <div className="text-editor">
      <textarea
        className="text-editor-content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Start typing..."
        spellCheck={false}
        aria-label={filePath ? `Editing ${filePath}` : 'Text Editor'}
      />
    </div>
  );
}
