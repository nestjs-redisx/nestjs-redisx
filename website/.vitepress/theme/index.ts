import DefaultTheme from 'vitepress/theme';
import Icon from './components/Icon.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Icon', Icon);
  }
};
