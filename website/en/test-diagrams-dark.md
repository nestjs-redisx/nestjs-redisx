# Mermaid Diagrams - Dark Theme Test

Тестовая страница для выбора стилей диаграмм (тёмная тема).

---

## ВЫБРАНО: Flowchart - Вариант 5 - Muted Professional (без фона)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#DC382D', 'primaryTextColor': '#F9FAFB', 'primaryBorderColor': '#991B1B', 'lineColor': '#9CA3AF', 'secondaryColor': '#1F2937', 'tertiaryColor': '#111827', 'secondaryTextColor': '#D1D5DB'}}}%%
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

## ВЫБРАНО: Sequence Diagram - Вариант 5 - Muted Professional

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#DC382D', 'primaryTextColor': '#F9FAFB', 'lineColor': '#9CA3AF', 'secondaryColor': '#1F2937', 'actorLineColor': '#9CA3AF', 'signalColor': '#D1D5DB', 'actorBkg': '#DC382D', 'actorTextColor': '#F9FAFB', 'noteBkgColor': '#111827', 'noteTextColor': '#D1D5DB'}}}%%
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

## ВЫБРАНО: State Diagram - Вариант 1 - Bright Red on Dark

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#FF6B6B', 'primaryTextColor': '#fff', 'primaryBorderColor': '#DC382D', 'lineColor': '#FF6B6B', 'secondaryColor': '#4B5563'}}}%%
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

### Вариант 3 - Dark theme

```mermaid
%%{init: {'theme': 'dark'}}%%
pie title Cache Performance
    "L1 Hits" : 45
    "L2 Hits" : 35
    "Misses" : 15
    "Errors" : 5
```

### Вариант 4 - Forest theme

```mermaid
%%{init: {'theme': 'forest'}}%%
pie title Cache Performance
    "L1 Hits" : 45
    "L2 Hits" : 35
    "Misses" : 15
    "Errors" : 5
```

### Вариант 5 - Base theme

```mermaid
%%{init: {'theme': 'base'}}%%
pie title Cache Performance
    "L1 Hits" : 45
    "L2 Hits" : 35
    "Misses" : 15
    "Errors" : 5
```
