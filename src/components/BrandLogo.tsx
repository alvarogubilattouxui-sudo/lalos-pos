import { useState } from "react";

/** Logo de Lalo's (el mismo de la web). Si no carga (sin internet), muestra el nombre en la tipografía de la marca. */
const LOGO_URL = "https://lalos-burgers.pages.dev/img/logo-h.webp";

export function BrandLogo({ className }: { className?: string }) {
  const [fallo, setFallo] = useState(false);
  if (fallo) {
    return (
      <span className={`font-display text-3xl uppercase leading-none tracking-poster text-azul ${className ?? ""}`}>
        Lalo&apos;s <span className="text-naranja">Burgas</span>
      </span>
    );
  }
  return <img src={LOGO_URL} alt="Lalo's Burgas" onError={() => setFallo(true)} className={className} draggable={false} />;
}
