import { createApp } from "vue";
import App from "./App.vue";
import { t } from "./i18n";

const app = createApp(App);
app.config.globalProperties.$t = t;
app.mount("#app");
