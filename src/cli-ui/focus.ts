export function focusCliInputAfterRender(): void {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('#cliInput');
    input?.focus();
  });
}

export function restoreCliViewAfterRender(): void {
  requestAnimationFrame(() => {
    const output = document.querySelector<HTMLElement>('#cliOutput');
    if (output) {
      output.scrollTop = output.scrollHeight;
    }
    const input = document.querySelector<HTMLInputElement>('#cliInput');
    input?.focus();
  });
}
