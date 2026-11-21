const TASK_MAX_CHARS = 16;

const NAMES_RU =
  "Аня Боря Вика Гоша Даша Егор Женя Зоя Игорь Катя Лёва Маша Нина Олег Петя Рита Саша Тоня Уля Федя Юля Яша Вера Глеб Дима Ира Костя Лиза Миша Надя Паша Рома Соня Тимур Света Артём Ваня Галя Денис Лена".split(
    " ",
  );

const NAMES_EN =
  "Alex Bea Cal Dana Eli Finn Gus Hana Ivy Jay Kai Lena Max Nia Owen Pia Quinn Rae Sam Tess Uma Vic Wes Xena Yuri Zoe Abe Bo Cleo Dex Eve Flo Gil Hugo Ida Jo Kit Leo Mia Ned".split(
    " ",
  );

// Words that say what kind of work it is, not which work, so they do not tell threads apart.
const FILLER = new Set(
  "a an and the of for to in on with from at by into via add fix make update debug investigate implement refactor check open create remove improve support issue error problem bug в во на и с со для по из к ко от до о об при за не а но или между через без под над у добавить сделать исправить починить открыть проверить разобраться настроить обновить убрать удалить перенести реализовать написать создать улучшить посмотреть найти понять диагностика исправление проблема проблемы ошибка ошибки баг".split(
    " ",
  ),
);

function fnv(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clean(word: string) {
  return word.replace(/^[^\p{L}\p{N}/#@]+|[^\p{L}\p{N}]+$/gu, "");
}

/** One or two words that say what a thread is about: "Добавить команду /schedule" → "Команду /schedule". */
export function officeTask(title: string): string {
  const all = title.split(/\s+/).map(clean).filter(Boolean);
  const meaningful = all.filter((word) => !FILLER.has(word.toLowerCase()));
  const pool = meaningful.length > 0 ? meaningful : all;
  const [first, second] = pool;
  if (first === undefined) return "";
  const pair = second !== undefined ? `${first} ${second}` : first;
  const picked = pair.length <= TASK_MAX_CHARS ? pair : first;
  return picked.charAt(0).toUpperCase() + picked.slice(1);
}

/**
 * A person's name for each thread, kept for the thread's life and unique in the office.
 * Ids are placed in sorted order, so a thread joining or leaving rarely renames anyone else.
 */
export function officeNames(ids: readonly string[], locale: string): string[] {
  const pool = locale.toLowerCase().startsWith("ru") ? NAMES_RU : NAMES_EN;
  const taken = new Map<number, string>();
  const byId = new Map<string, string>();
  for (const id of [...new Set(ids)].sort()) {
    let slot = fnv(id) % pool.length;
    for (let tries = 0; taken.has(slot) && tries < pool.length; tries++) {
      slot = (slot + 1) % pool.length;
    }
    taken.set(slot, id);
    byId.set(id, pool[slot] ?? "");
  }
  return ids.map((id) => byId.get(id) ?? "");
}
