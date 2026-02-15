# Mermaid Diagrams - Light Theme Test

Тестовая страница для выбора стилей диаграмм (светлая тема).

---

## ВЫБРАНО: Flowchart - Вариант 5 - Soft Pastels (без фона)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#FCA5A5', 'primaryTextColor': '#7F1D1D', 'primaryBorderColor': '#F87171', 'lineColor': '#DC382D', 'secondaryColor': '#FEF2F2', 'tertiaryColor': '#FEE2E2', 'secondaryTextColor': '#991B1B'}}}%%
graph TB
    subgraph "Your Application"
        Controller[Controller]
        Service[Service]
    end

    subgraph "NestJS RedisX"
        Core[RedisX Core]
        Cache[Cache Plugin]
        Locks[Locks Plugin]
        RateLimit[Rate Limit Plugin]
    end

    subgraph "Infrastructure"
        Redis[(Redis)]
    end

    Controller --> Service
    Service --> Cache
    Service --> Locks
    Service --> RateLimit
    Cache --> Core
    Locks --> Core
    RateLimit --> Core
    Core --> Redis
```

---

## ВЫБРАНО: Sequence Diagram - Вариант 5 - Soft Pastels

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#FCA5A5', 'primaryTextColor': '#7F1D1D', 'lineColor': '#F87171', 'secondaryColor': '#FEF2F2', 'actorLineColor': '#F87171', 'signalColor': '#991B1B', 'actorBkg': '#FCA5A5', 'actorTextColor': '#7F1D1D', 'noteBkgColor': '#FEE2E2', 'noteTextColor': '#991B1B'}}}%%
sequenceDiagram
    participant Client
    participant Service
    participant L1 as L1 Cache
    participant L2 as L2 Redis
    participant DB as Database

    Client->>Service: getUser(123)
    Service->>L1: check memory
    L1-->>Service: miss
    Service->>L2: check Redis
    L2-->>Service: miss
    Service->>DB: query
    DB-->>Service: user data
    Service->>L2: set cache
    Service->>L1: set cache
    Service-->>Client: return user
```

---

## ВЫБРАНО: State Diagram - Вариант 1 - Redis Red монохром

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#DC382D', 'primaryTextColor': '#fff', 'primaryBorderColor': '#B91C1C', 'lineColor': '#DC382D', 'secondaryColor': '#FF6B6B'}}}%%
stateDiagram-v2
    [*] --> Idle
    Idle --> Acquiring: acquire()
    Acquiring --> Locked: success
    Acquiring --> Failed: timeout
    Locked --> Extending: extend()
    Extending --> Locked: success
    Locked --> Released: release()
    Failed --> Idle: retry
    Released --> [*]
```

---

## Pie Chart - варианты

### Вариант 1 - Default theme

```mermaid
pie title Cache Performance
    "L1 Hits" : 45
    "L2 Hits" : 35
    "Misses" : 15
    "Errors" : 5
```

### Вариант 2 - Neutral theme

```mermaid
%%{init: {'theme': 'neutral'}}%%
pie title Cache Performance
    "L1 Hits" : 45
    "L2 Hits" : 35
    "Misses" : 15
    "Errors" : 5
```

### Вариант 3 - Forest theme

```mermaid
%%{init: {'theme': 'forest'}}%%
pie title Cache Performance
    "L1 Hits" : 45
    "L2 Hits" : 35
    "Misses" : 15
    "Errors" : 5
```

### Вариант 4 - Base theme

```mermaid
%%{init: {'theme': 'base'}}%%
pie title Cache Performance
    "L1 Hits" : 45
    "L2 Hits" : 35
    "Misses" : 15
    "Errors" : 5
```

### Вариант 5 - Dark theme

```mermaid
%%{init: {'theme': 'dark'}}%%
pie title Cache Performance
    "L1 Hits" : 45
    "L2 Hits" : 35
    "Misses" : 15
    "Errors" : 5
```
