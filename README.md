# Elsewhere

A responsive Next.js and TypeScript prototype for discovering films and series. It uses a small local catalogue and browser `localStorage`; there is no recommendation algorithm, server data store, or media API.

## Run it

```sh
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). The development server uses port `4173` to keep the prototype URL consistent. Stop it with `Ctrl+C`.

## Try the prototype

1. Choose Movies, TV, or Anime and pass or shortlist a few titles. Drag a card, use the buttons, or press `←` and `→`.
2. Open a title’s details, then close the overlay or add it to your shortlist.
3. Use Undo to reverse the latest discovery choice. Refresh the page to see the session persist.
4. Open **Review & compare**, prune a pick, then restore it from **Removed for now**. Keep browsing or save the remaining shortlist.
5. Saved titles appear under **Saved** and stay separate from the temporary shortlist.
6. Open **Adult** to see the age gate. Its confirmation is a local prototype interaction; it does not verify identity or age.

The example catalogue is in `src/data.ts`, the Next.js page is in `src/app/page.tsx`, and the global styles are in `src/app/globals.css`. Example artwork is drawn with local CSS gradients and shapes. Google Fonts are loaded from their stylesheet, with system fallbacks available.

Run `npm run typecheck` for a TypeScript check and `npm run build` to verify a production build. Clear the `elsewhere-discovery-v1` localStorage key in the browser’s site storage controls to reset the local session and saved list.
