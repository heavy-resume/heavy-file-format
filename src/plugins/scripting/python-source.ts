// Scripts execute inside a function so they can return a result to their host.
// Keep syntax validation and execution on exactly the same source wrapper.
export function wrapPythonSourceInFunction(source: string): string {
  const lines = source.split('\n');
  const body = lines.length > 0 && lines.some((line) => line.trim().length > 0)
    ? lines.map((line) => `    ${line}`)
    : ['    pass'];
  return [
    'def __hvy_user_main__():',
    ...body,
  ].join('\n');
}
