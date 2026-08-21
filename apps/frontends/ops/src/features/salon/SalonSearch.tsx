// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Button, Icon, Input } from "@giromesa/ui";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";

export interface SalonSearchOption {
  id: string;
  label: string;
  meta: string;
  keywords?: string;
}

export function SalonSearch({
  options,
  placeholder,
  value,
  onChange,
  onSelect,
}: {
  options: SalonSearchOption[];
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (option: SalonSearchOption) => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = value.trim().toLocaleLowerCase("pt-BR");
  const visibleOptions = useMemo(
    () =>
      options
        .filter((option) =>
          `${option.label} ${option.meta} ${option.keywords ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedQuery),
        )
        .slice(0, 8),
    [normalizedQuery, options],
  );

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function focusShortcut(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      const isShortcut =
        (!isEditable && event.key === "/") ||
        ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("pt-BR") === "k");
      const openDialog = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (!isShortcut || (openDialog && !openDialog.contains(inputRef.current))) return;
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    }
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", focusShortcut);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", focusShortcut);
    };
  }, []);

  function selectOption(option: SalonSearchOption) {
    setOpen(false);
    onSelect(option);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return (current + direction + visibleOptions.length) % Math.max(visibleOptions.length, 1);
      });
      return;
    }
    if (event.key === "Enter" && open && visibleOptions[activeIndex]) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex]);
    }
  }

  return (
    <search
      className="search-field salon-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      ref={rootRef}
    >
      <Icon name="search" size={17} />
      <Input
        aria-activedescendant={open ? `${listId}-option-${activeIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-label={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={inputRef}
        role="combobox"
        value={value}
      />
      <Button
        aria-label="Focar busca. Atalho barra ou Control K"
        className="salon-search__shortcut"
        onClick={() => {
          inputRef.current?.focus();
          setOpen(true);
        }}
        title="Atalho: / ou Ctrl+K"
        type="button"
        variant="ghost"
      >
        <kbd>/</kbd>
      </Button>
      {open && visibleOptions.length > 0 && (
        <div className="salon-search__results" id={listId} role="listbox">
          {visibleOptions.map((option, index) => (
            <Button
              aria-selected={activeIndex === index}
              id={`${listId}-option-${index}`}
              key={option.id}
              onClick={() => selectOption(option)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
              variant="ghost"
            >
              <span>{option.label}</span>
              <small>{option.meta}</small>
            </Button>
          ))}
        </div>
      )}
    </search>
  );
}
