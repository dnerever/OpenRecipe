import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { commonmarkLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import { changedLineNumbers } from '../lib/change-lines.ts';

/**
 * CodeMirror, finally.
 *
 * The textarea it replaces was the right call for three slices — syntax colour
 * alone never justified 45 kB. What justifies it now is the decoration below:
 * while you edit, the gutter shows which lines differ from the version you
 * started from, so "what am I actually changing" is answerable without leaving
 * the page. That is the same question the diff view answers after the fact, and
 * it is the reason docs/PLAN.md parked CodeMirror here rather than in Slice 3.
 *
 * The language is `yamlFrontmatter` over `markdown`, which is precisely the
 * recipe format — the fence really is a YAML/Markdown boundary, not a
 * convention we paint over one.
 */
export function SourceEditor({
  value,
  onChange,
  baseline,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The saved content this draft started from. Omit on a new recipe. */
  baseline?: string | undefined;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);

  // Kept in a ref so a new `onChange` identity never tears down the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          yamlFrontmatter({ content: commonmarkLanguage }),
          syntaxHighlighting(recipeHighlight),
          baselineField,
          changeDecorations,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Recipe source' }),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Mount once. Later `value` and `baseline` changes are dispatched below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only fires when the value changed somewhere other than the editor —
  // typing already round-trips through `onChange`, and re-dispatching that
  // would drop the cursor to the end of the document on every keystroke.
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setBaseline.of(baseline ?? '') });
  }, [baseline]);

  return <div className="source-editor" ref={host} />;
}

/* --------------------------------------------------- live change gutter -- */

const setBaseline = StateEffect.define<string>();

const baselineField = StateField.define<string>({
  create: () => '',
  update: (current, tr) => {
    for (const effect of tr.effects) if (effect.is(setBaseline)) return effect.value;
    return current;
  },
});

const changed = Decoration.line({ class: 'cm-changed' });
const deletedHere = Decoration.line({ class: 'cm-deleted-here' });

const changeDecorations = StateField.define<DecorationSet>({
  create: (state) => decorate(state),
  update: (current, tr) => {
    const rebaselined = tr.effects.some((e) => e.is(setBaseline));
    return tr.docChanged || rebaselined ? decorate(tr.state) : current;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function decorate(state: EditorState): DecorationSet {
  const { edited, deletedBefore } = changedLineNumbers(
    state.field(baselineField),
    state.doc.toString(),
  );
  if (edited.size === 0 && deletedBefore.size === 0) return Decoration.none;

  const marks: Range<Decoration>[] = [];
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const mark = edited.has(n) ? changed : deletedBefore.has(n) ? deletedHere : null;
    if (mark) marks.push(mark.range(state.doc.line(n).from));
  }
  return Decoration.set(marks);
}

/* ----------------------------------------------------------------- look -- */

/**
 * Colours come from the app's own tokens, so the editor follows the light/dark
 * switch with everything else instead of shipping a second palette.
 */
const theme = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'var(--paper)', fontSize: '0.86rem' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '.cm-content': { fontFamily: 'ui-monospace, monospace', padding: '0.6rem 0' },
  '.cm-gutters': {
    color: 'var(--ink-2)',
    backgroundColor: 'var(--surface)',
    border: 'none',
    borderRight: '1px solid var(--rule)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--accent) 6%, transparent)' },
  '.cm-line.cm-changed': {
    backgroundColor: 'color-mix(in oklab, var(--good) 14%, transparent)',
    boxShadow: 'inset 3px 0 0 var(--good)',
  },
  '.cm-line.cm-deleted-here': { boxShadow: 'inset 3px 0 0 var(--bad)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, var(--accent) 22%, transparent)',
  },
});

const recipeHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--accent)', fontWeight: '700' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--accent)' },
  { tag: [tags.string, tags.number, tags.bool], color: 'var(--good)' },
  { tag: tags.comment, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: [tags.contentSeparator, tags.meta], color: 'var(--ink-2)' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strong], fontWeight: '700' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
]);
