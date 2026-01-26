// Simple status check
fetch('http://localhost:3000/api/health') // We might need to make this endpoint or just check /
    .then(res => {
        if (res.ok) {
            document.getElementById('text').innerText = "Connected to Brain";
            document.getElementById('dot').classList.remove('disconnected');
        } else {
            throw new Error('Failed');
        }
    })
    .catch(() => {
        document.getElementById('text').innerText = "Disconnected (Is server running?)";
        document.getElementById('dot').classList.add('disconnected');
    });
