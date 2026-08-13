# edge-ai/app/rag.py
from langchain_community.embeddings import OllamaEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_community.llms import Ollama
from langchain.chains import RetrievalQA
import os

PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
COLLECTION_NAME = "survival_manuals"

def get_qa_chain():
    embeddings = OllamaEmbeddings(model="llama3")  # local Ollama server
    vectordb = Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
        persist_directory=PERSIST_DIR,
    )
    retriever = vectordb.as_retriever(search_kwargs={"k": 3})
    llm = Ollama(model="llama3", temperature=0.1)
    qa = RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",
        retriever=retriever,
        return_source_documents=True,
    )
    return qa

# FastAPI endpoint
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

class Query(BaseModel):
    question: str

app = FastAPI()

@app.post("/rag/query")
async def rag_query(query: Query):
    chain = get_qa_chain()
    result = chain({"query": query.question})
    return {"answer": result["result"], "sources": []}