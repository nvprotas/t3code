const MAX_CHARS = 14;
const MAX_WORDS = 3;

function words(title: string) {
  return title.trim().split(/\s+/).filter(Boolean);
}

function sameStart(left: readonly string[], right: readonly string[], count: number) {
  return (
    left.slice(0, count).join(" ").toLowerCase() === right.slice(0, count).join(" ").toLowerCase()
  );
}

/** Long leading words shrink to "Abcd." so the word that tells two threads apart still fits. */
function compose(picked: readonly string[]) {
  const full = picked.join(" ");
  if (full.length <= MAX_CHARS || picked.length === 1) return full;
  const last = picked[picked.length - 1];
  const lead = picked.slice(0, -1).map((word) => (word.length > 5 ? `${word.slice(0, 4)}.` : word));
  return [...lead, last].join(" ");
}

/** Name tags for the office: the first word of each title, plus as many as it takes to be unique. */
export function officeShortNames(titles: readonly string[]): string[] {
  const split = titles.map(words);
  return split.map((own, index) => {
    // A short first word ("Fix", "Add") says little on its own.
    let count = own[0] !== undefined && own[0].length <= 3 ? 2 : 1;
    while (
      count < Math.min(own.length, MAX_WORDS) &&
      split.some((other, otherIndex) => otherIndex !== index && sameStart(other, own, count))
    ) {
      count++;
    }
    return compose(own.slice(0, count));
  });
}
