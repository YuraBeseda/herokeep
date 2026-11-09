import { askOnce } from './ask-once';

describe('askOnce', () => {
  it('a second ask while the prompt is open shares the first prompt', async () => {
    let open!: (answer: boolean) => void;
    const prompt = vi.fn(() => new Promise<boolean>((resolve) => (open = resolve)));
    const ask = askOnce(prompt);
    const first = ask();
    const second = ask();
    expect(prompt).toHaveBeenCalledTimes(1);
    open(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });

  it('asks again once the previous prompt has settled', async () => {
    const prompt = vi.fn(() => Promise.resolve(false));
    const ask = askOnce(prompt);
    await ask();
    await ask();
    expect(prompt).toHaveBeenCalledTimes(2);
  });
});
