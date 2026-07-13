import { enqueue } from '../helpers.js';

for (let i = 1; i <= 5; i++) {
    const res = await enqueue({ id: i, command: `sleep ${i}` });
    if (res.exitCode === 0) {
        console.log(`Enqueued : ${i}`);
    } else {
        console.error(`Failed to enqueue  ${i}:`, res.stderr);
    }
}

console.log("Successfully enqueued 100 echo jobs.");
