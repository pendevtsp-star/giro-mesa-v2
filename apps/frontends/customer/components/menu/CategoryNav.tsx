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
      <label className="search">
        <span aria-hidden="true">⌕</span>
        <span className="sr-only">Buscar no cardápio</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Buscar pratos e ingredientes"
        />
      </label>
      <fieldset className="category-fieldset">
        <legend className="sr-only">Categorias</legend>
        <div className="category-list">
          {categories.map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={category === item}
              onClick={() => onCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
