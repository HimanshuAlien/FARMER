let KNOWLEDGE = [];

fetch("ai/knowledge.json")
    .then(res => res.json())
    .then(data => KNOWLEDGE = data)
    .catch(() => KNOWLEDGE = []);

function askAI(query) {
    query = query.toLowerCase();

    for (let item of KNOWLEDGE) {
        if (item.keywords.some(k => query.includes(k))) {
            return item;
        }
    }

    return {
        answer: "I cannot give a confident offline answer for this question.",
        why: "This query is outside my locally stored and verified knowledge base.",
        action: "Please consult an expert or connect to the internet for updated guidance."
    };
}
