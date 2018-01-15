import {CompositeDisposable} from 'atom';

import {autobind} from 'core-decorators';

export default class GitDiffView {
  constructor(editor, getActiveRepository) {
    this.editor = editor;
    this.getActiveRepository = getActiveRepository;
    this.subscriptions = new CompositeDisposable();
    this.markers = [];

    this.subscriptions.add(this.editor.onDidStopChanging(this.updateDiffs));
    this.subscriptions.add(this.editor.onDidChangePath(this.updateDiffs));

    this.subscriptions.add(
      this.editor.onDidDestroy(() => {
        this.cancelUpdate();
        this.removeDecorations();
        this.subscriptions.dispose();
      }),
    );

    const editorView = atom.views.getView(this.editor);

    this.subscriptions.add(
      atom.commands.add(editorView, 'git-diff:move-to-next-diff', () => {
        this.moveToNextDiff();
      }),
    );
    this.subscriptions.add(
      atom.commands.add(editorView, 'git-diff:move-to-previous-diff', () => {
        this.moveToPreviousDiff();
      }),
    );

    this.subscriptions.add(
      atom.config.onDidChange('git-diff.showIconsInEditorGutter', () => {
        this.updateIconDecoration();
      }),
    );

    this.subscriptions.add(
      atom.config.onDidChange('editor.showLineNumbers', () => {
        this.updateIconDecoration();
      }),
    );

    const editorElement = atom.views.getView(this.editor);
    this.subscriptions.add(
      editorElement.onDidAttach(() => {
        this.updateIconDecoration();
      }),
    );

    this.updateIconDecoration();
    this.scheduleUpdate();
  }

  moveToNextDiff() {
    if (!this.diffs) {
      return;
    }
    const cursorLineNumber = this.editor.getCursorBufferPosition().row + 1;
    let nextDiffLineNumber = null;
    let firstDiffLineNumber = null;
    for (const {newStart} of this.diffs) {
      if (newStart > cursorLineNumber) {
        if (nextDiffLineNumber == null) {
          nextDiffLineNumber = newStart - 1;
        }
        nextDiffLineNumber = Math.min(newStart - 1, nextDiffLineNumber);
      }

      if (firstDiffLineNumber == null) {
        firstDiffLineNumber = newStart - 1;
      }
      firstDiffLineNumber = Math.min(newStart - 1, firstDiffLineNumber);
    }

    // Wrap around to the first diff in the file
    if (nextDiffLineNumber == null) {
      nextDiffLineNumber = firstDiffLineNumber;
    }

    this.moveToLineNumber(nextDiffLineNumber);
  }

  updateIconDecoration() {
    const gutter = atom.views.getView(this.editor).querySelector('.gutter');
    if (
      atom.config.get('editor.showLineNumbers') &&
      atom.config.get('git-diff.showIconsInEditorGutter')
    ) {
      if (gutter != null) {
        gutter.classList.add('git-diff-icon');
      }
    } else {
      if (gutter != null) {
        gutter.classList.remove('git-diff-icon');
      }
    }
  }

  moveToPreviousDiff() {
    if (!this.diffs) {
      return;
    }
    const cursorLineNumber = this.editor.getCursorBufferPosition().row + 1;
    let previousDiffLineNumber = -1;
    let lastDiffLineNumber = -1;
    for (const {newStart} of this.diffs) {
      if (newStart < cursorLineNumber) {
        previousDiffLineNumber = Math.max(newStart - 1, previousDiffLineNumber);
      }
      lastDiffLineNumber = Math.max(newStart - 1, lastDiffLineNumber);
    }

    // Wrap around to the last diff in the file
    if (previousDiffLineNumber === -1) {
      previousDiffLineNumber = lastDiffLineNumber;
    }

    this.moveToLineNumber(previousDiffLineNumber);
  }

  moveToLineNumber(lineNumber) {
    if (lineNumber != null && lineNumber >= 0) {
      this.editor.setCursorBufferPosition([lineNumber, 0]);
      this.editor.moveToFirstCharacterOfLine();
    }
  }

  cancelUpdate() {
    clearImmediate(this.immediateId);
  }

  scheduleUpdate() {
    this.cancelUpdate();
    this.immediateId = setImmediate(this.updateDiffs);
  }

  @autobind
  async updateDiffs() {
    const path = this.editor.getPath();
    const repository = this.getActiveRepository();
    if (this.editor.isDestroyed() || !path || !repository || repository.isLoading() || !repository.isPresent()) {
      this.removeDecorations();
      return;
    }

    const relativePath = atom.project.relativizePath(path)[1];
    const options = this.editor.isModified() ? {content: this.editor.getText(), context: 0} : {context: 0};
    const filePatch = await repository.getFilePatchForPath(relativePath, options);
    this.removeDecorations();
    if (filePatch) {
      const hunks = filePatch.getHunks();
      // For compatibility with old git-diff code
      this.diffs = hunks.map(hunk => {
        return {
          newStart: hunk.getNewStartRow(),
          oldLines: hunk.getOldRowCount(),
          newLines: hunk.getNewRowCount(),
        };
      });
      this.addDecorations(this.diffs);
    }
  }

  addDecorations(diffs) {
    diffs.forEach(({newStart, oldLines, newLines}) => {
      const startRow = newStart - 1;
      const endRow = newStart + newLines - 1;
      if (oldLines === 0 && newLines > 0) {
        this.markRange(startRow, endRow, 'git-line-added');
      } else if (newLines === 0 && oldLines > 0) {
        this.markRange(startRow, startRow, 'git-line-removed');
      } else {
        this.markRange(startRow, endRow, 'git-line-modified');
      }
    });
  }

  removeDecorations() {
    for (const marker of this.markers) {
      marker.destroy();
    }
    this.markers = [];
  }

  markRange(startRow, endRow, klass) {
    const marker = this.editor.markBufferRange([[startRow, 0], [endRow, 0]], {
      invalidate: 'never',
    });
    this.editor.decorateMarker(marker, {type: 'line-number', class: klass});
    this.markers.push(marker);
  }
}
