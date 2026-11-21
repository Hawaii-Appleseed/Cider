// Names the editor's script uses and does not define in a way TypeScript can
// see. Keep this short: a name belongs here only when it truly comes from
// outside docsync/editor/edit.html's own script, or is made in it by an
// assignment to window. Anything else that "cannot be found" is a bug.

/** From the Pyodide <script src> above the editor's own script. */
declare function loadPyodide(options?: any): Promise<any>;

/** The pilot API. The script makes it with `window.docsync = { … }` and then
 *  uses the bare name, which a classic script may. */
declare var docsync: any;

/** Libraries the script import()s from a CDN at run time. */
declare module 'https://cdn.jsdelivr.net/*' {
  const lib: any;
  export = lib;
}
