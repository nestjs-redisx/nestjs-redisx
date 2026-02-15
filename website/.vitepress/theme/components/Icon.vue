<script setup lang="ts">
import {
  Building2,
  Target,
  FlaskConical,
  BookOpen,
  Rocket,
  Plug,
  Package,
  Server,
  Shield,
  Zap,
  Settings,
  Terminal,
  CheckCircle,
  AlertTriangle,
  Info,
  Lightbulb,
  ArrowRight,
  ExternalLink,
  Github,
  Database,
  Clock,
  RefreshCw,
  Tag,
  Cpu,
  BarChart3,
  Search,
  Eye
} from 'lucide-vue-next'

const props = defineProps<{
  name: string
  size?: number
}>()

const icons: Record<string, any> = {
  'building': Building2,
  'target': Target,
  'flask': FlaskConical,
  'book': BookOpen,
  'rocket': Rocket,
  'plug': Plug,
  'package': Package,
  'server': Server,
  'shield': Shield,
  'zap': Zap,
  'settings': Settings,
  'terminal': Terminal,
  'check': CheckCircle,
  'warning': AlertTriangle,
  'info': Info,
  'lightbulb': Lightbulb,
  'arrow-right': ArrowRight,
  'external': ExternalLink,
  'github': Github,
  'database': Database,
  'clock': Clock,
  'refresh': RefreshCw,
  'tag': Tag,
  'cpu': Cpu,
  'chart': BarChart3,
  'search': Search,
  'eye': Eye
}
</script>

<template>
  <component
    :is="icons[name]"
    :size="size || 18"
    class="inline-icon"
  />
</template>

<style scoped>
.inline-icon {
  display: inline-block;
  vertical-align: middle;
  margin-right: 0.25em;
}
</style>
