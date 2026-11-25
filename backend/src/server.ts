import app from "./index";
import { env } from "./constants/env";
app.listen(env.PORT, () => console.log(`Bantai API listening on port ${env.PORT}`));
