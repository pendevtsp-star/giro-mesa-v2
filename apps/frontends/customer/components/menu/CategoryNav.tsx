export function CategoryNav({
  categories,
  category,
  query,
  onCategory,
  onQuery,
}: {
  categories: string[];
  category: string;
  query: string;
  onCategory: (category: string) => void;
  onQuery: (query: string) => void;
}) {
  return (
    <section className="menu-toolbar" aria-label="Filtros do cardápio">
      <SearchField
        aria-label="Buscar no cardápio"
        className="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Buscar pratos e ingredientes"
      />
      <fieldset className="category-fieldset">
        <legend className="sr-only">Categorias</legend>
        <div className="category-list">
          {categories.map((item) => (
            <Button
              type="button"
              key={item}
              aria-pressed={category === item}
              onClick={() => onCategory(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

import { Button, SearchField } from "@giromesa/ui";
