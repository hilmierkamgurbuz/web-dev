# Blueprint

The single authority for what goes where. `wd check` compares it with the disk, the notes' `sys` fields, and the route and table maps. Arrows are one-directional: a feature depends on another, never both ways.

## Features
- <sys> — <one-line responsibility> → depends on: <sys, sys | ->

## Routes
- PAGE <path> — <sys>
- <GET|POST|PUT|PATCH|DELETE> <path> — <sys>
- ACTION <exportName> — <sys>

## Tables
- <table> — owner: <sys>

## Folder layout
```
src/
  app/                 routes, layouts, pages
  features/<sys>/      feature modules: components, server, hooks, tests
  lib/                 shared infrastructure used by two or more features
```

## Conventions
- <naming, colocation and import rules agreed with the user>
