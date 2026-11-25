import ScrollReveal from "./ScrollReveal";

type GridItem = readonly [title: string, description: string];

export default function HairlineGrid({ items }: { items: readonly GridItem[] }) {
  const tabletLastRow = Math.floor((items.length - 1) / 2) * 2;
  const desktopLastRow = Math.floor((items.length - 1) / 3) * 3;

  return (
    <div role="list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {items.map(([title, description], index) => (
        <div
          key={title} role="listitem"
          className={[
            "min-w-0 border-subtle p-8 sm:p-10",
            index < items.length - 1 && "border-b",
            index >= tabletLastRow && "md:border-b-0",
            index < desktopLastRow ? "lg:border-b" : "lg:border-b-0",
            index % 2 === 0 && index + 1 < items.length && "md:border-r",
            index % 3 !== 2 && index + 1 < items.length ? "lg:border-r" : "lg:border-r-0",
          ].filter(Boolean).join(" ")}
        >
          <ScrollReveal delay={(index % 3) * 70}>
            <h3 className="mb-2.5 text-base font-medium text-primary">{title}</h3>
            <p className="text-sm leading-relaxed text-secondary">{description}</p>
          </ScrollReveal>
        </div>
      ))}
    </div>
  );
}

