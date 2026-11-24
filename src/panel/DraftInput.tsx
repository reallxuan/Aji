import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';

export const DECIMAL_INPUT_MODE = 'decimal';
export type RegisterEditor = (finish: () => void) => () => void;

/** Follow the confirmed or pending value except while a newer draft is being typed. */
export function DraftInput({
  value,
  onCommit,
  register,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string;
  onCommit(value: string): void;
  register?: RegisterEditor;
}) {
  const [text, setText] = useState<string | null>(null);
  const draft = useRef<string | null>(null);
  const finish = () => {
    const next = draft.current;
    if (next === null) return;
    draft.current = null;
    setText(null);
    if (next !== value) onCommit(next);
  };
  const latest = useRef(finish);
  useLayoutEffect(() => {
    latest.current = finish;
  });
  useLayoutEffect(() => {
    const unregister = register?.(() => latest.current());
    return () => {
      unregister?.();
      latest.current();
    };
  }, [register]);
  return (
    <input
      {...props}
      value={text ?? value}
      onChange={(e) => {
        draft.current = e.target.value;
        setText(e.target.value);
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          finish();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          draft.current = null;
          setText(null);
        }
      }}
    />
  );
}
