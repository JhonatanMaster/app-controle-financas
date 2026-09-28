export const UNGROUPED_LABEL = "Outros";
export const UNGROUPED_KEY = "sem-grupo";

/**
 * Quando nada foi agrupado ainda, um cabecalho unico dizendo Outros so poluiria a tela.
 */
export function shouldShowHeaders<T>(sections: Section<T>[]) {
  return sections.length > 1 || (sections.length === 1 && sections[0].key !== UNGROUPED_KEY);
}

export type Section<T> = {
  key: string;
  label: string;
  items: T[];
};

type GroupRef = { id: string | null; name: string | null; sortOrder: number | null };

/**
 * Agrupa itens nas secoes do mercado, na ordem em que se percorre as gondolas.
 * Itens sem grupo caem em Outros, que fica sempre por ultimo.
 */
export function groupIntoSections<T>(items: T[], getGroup: (item: T) => GroupRef): Section<T>[] {
  const sections = new Map<string, Section<T> & { sortOrder: number }>();

  for (const item of items) {
    const group = getGroup(item);
    const key = group.id ?? UNGROUPED_KEY;

    let section = sections.get(key);
    if (!section) {
      section = {
        key,
        label: group.name ?? UNGROUPED_LABEL,
        sortOrder: group.id ? (group.sortOrder ?? 0) : Number.MAX_SAFE_INTEGER,
        items: [],
      };
      sections.set(key, section);
    }
    section.items.push(item);
  }

  return [...sections.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "pt-BR"))
    .map(({ key, label, items: sectionItems }) => ({ key, label, items: sectionItems }));
}
